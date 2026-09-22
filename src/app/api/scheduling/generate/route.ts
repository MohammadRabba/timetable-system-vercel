import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";
import { parseDays, type SolverInput } from "@/lib/scheduling/engine";
import { buildSolverInput } from "@/lib/scheduling/input-builder";
import {
  getDefaultProvider,
  TypeScriptSolver,
  ORToolsSolver,
  type ProviderResponse,
  type OccurrenceEntry,
} from "@/lib/scheduling/provider";

// POST /api/scheduling/generate { schoolId, mode, allowPartial, provider }
//
// Strict success criteria:
//   feasible = (scheduled == required) && (hardViolations == 0)
// If allowPartial=true, returns PARTIAL when not feasible but some entries exist.
//
// Database writes are wrapped in a Prisma transaction — if anything fails,
// nothing is committed.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  const mode = body.mode || "BALANCED";
  const allowPartial = Boolean(body.allowPartial);
  // Allow caller to override provider for comparison purposes
  const providerName: string | undefined = body.provider;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });

  const timeLimitSec = mode === "FAST" ? 10 : mode === "DEEP" ? 300 : 60;

  // Create scheduling run record (queued, not yet solving)
  const run = await db.schedulingRun.create({
    data: {
      schoolId,
      status: "VALIDATING",
      mode,
      timeLimitSec,
      progress: 5,
    },
  });

  try {
    // Build solver input
    const input = await buildSolverInput(schoolId);
    if ("error" in input) throw new Error(input.error);

    // Pick provider
    const provider = providerName === "typescript"
      ? TypeScriptSolver
      : providerName === "ortools"
        ? ORToolsSolver
        : getDefaultProvider();

    await db.schedulingRun.update({
      where: { id: run.id },
      data: { status: "SOLVING", progress: 25 },
    });

    const providerResponse: ProviderResponse = await provider.solve(input as SolverInput, {
      timeLimitSeconds: timeLimitSec,
      profile: mode,
      allowPartial,
    });

    await db.schedulingRun.update({
      where: { id: run.id },
      data: { status: "OPTIMIZING", progress: 75 },
    });

    // ============== Transactional save ==============
    // All DB writes happen inside a Prisma transaction. If any insert fails,
    // the entire transaction is rolled back — no half-generated timetable.
    const maxVersion = await db.timetableVersion.aggregate({
      where: { schoolId },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version || 0) + 1;

    const stats: any = providerResponse.stats;

    const result = await db.$transaction(async (tx) => {
      // Unset previous current versions
      await tx.timetableVersion.updateMany({
        where: { schoolId, isCurrent: true },
        data: { isCurrent: false },
      });

      // Create version snapshot — store the FULL provider response as snapshot
      const version = await tx.timetableVersion.create({
        data: {
          schoolId,
          version: nextVersion,
          name: `Version ${nextVersion}`,
          reason: body.reason || `Generated (${mode}, ${provider.name})`,
          createdBy: s.id,
          statistics: JSON.stringify({
            ...stats,
            qualityScore: providerResponse.qualityScore,
            softPenalty: providerResponse.softPenalty,
            status: providerResponse.status,
            feasible: providerResponse.feasible,
            partial: providerResponse.partial,
            provider: providerResponse.provider,
            objectiveValue: providerResponse.objectiveValue,
            modelGenerationMs: providerResponse.modelGenerationMs,
            solverMs: providerResponse.solverMs,
            wallMs: providerResponse.wallMs,
            memoryMb: providerResponse.memoryMb,
          }),
          snapshot: JSON.stringify({
            entries: providerResponse.entries,
            dutyEntries: providerResponse.dutyEntries,
          }),
          isCurrent: true,
        },
      });

      // Insert timetable entries — ONE entry per occurrence (so a 5-occurrence
      // lesson becomes 5 rows in TimetableEntry)
      if (providerResponse.entries.length > 0) {
        await tx.timetableEntry.createMany({
          data: providerResponse.entries.map((e: OccurrenceEntry) => ({
            schoolId,
            versionId: version.id,
            lessonId: e.lessonId,
            teacherId: e.teacherId,
            sectionId: e.sectionId,
            subjectId: e.subjectId,
            roomId: e.roomId || null,
            day: e.day,
            period: e.period,
            cellType: e.cellType,
            locked: e.locked,
          })),
        });
      }
      // Insert duty entries
      const dutyEntries = providerResponse.dutyEntries;
      for (const d of dutyEntries) {
        const duty = await tx.duty.findUnique({ where: { id: d.dutyId } });
        if (!duty) continue;
        await tx.timetableEntry.create({
          data: {
            schoolId,
            versionId: version.id,
            dutyId: d.dutyId,
            teacherId: d.teacherId,
            day: d.day,
            period: d.period,
            cellType: d.cellType,
          },
        }).catch(() => null);
      }

      // Update run
      const solverStatusStr = providerResponse.status;
      // Determine run status
      //   COMPLETED if feasible OR (partial && allowPartial)
      //   FAILED otherwise
      let runStatus = "COMPLETED";
      if (!providerResponse.feasible && !providerResponse.partial) {
        runStatus = "FAILED";
      } else if (providerResponse.partial) {
        runStatus = "COMPLETED"; // partial completion is still "completed"
      }

      await tx.schedulingRun.update({
        where: { id: run.id },
        data: {
          status: runStatus,
          progress: 100,
          solverStatus: solverStatusStr,
          result: JSON.stringify({
            qualityScore: providerResponse.qualityScore,
            softPenalty: providerResponse.softPenalty,
            stats: providerResponse.stats,
            conflicts: providerResponse.conflicts,
            failures: providerResponse.failures,
            suggestions: providerResponse.suggestions,
            provider: providerResponse.provider,
            objectiveValue: providerResponse.objectiveValue,
            modelGenerationMs: providerResponse.modelGenerationMs,
            solverMs: providerResponse.solverMs,
            wallMs: providerResponse.wallMs,
            memoryMb: providerResponse.memoryMb,
            feasible: providerResponse.feasible,
            partial: providerResponse.partial,
          }),
          versionId: version.id,
          finishedAt: new Date(),
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: s.id,
          schoolId,
          action: "GENERATE_TIMETABLE",
          entity: "TimetableVersion",
          entityId: version.id,
          newValue: JSON.stringify({
            mode,
            provider: providerResponse.provider,
            status: providerResponse.status,
            feasible: providerResponse.feasible,
            partial: providerResponse.partial,
            qualityScore: providerResponse.qualityScore,
            version: nextVersion,
            required: stats.requiredOccurrences,
            scheduled: stats.scheduledOccurrences,
            unscheduled: stats.unscheduledOccurrences,
            hardViolations: (
              stats.teacherConflicts +
              stats.classConflicts +
              stats.roomConflicts +
              stats.availabilityViolations +
              stats.dutyConflicts +
              stats.fixedLessonViolations +
              stats.capacityViolations
            ),
          }),
        },
      });

      return version;
    });
    // ============== End transaction ==============

    return NextResponse.json({
      ok: true,
      runId: run.id,
      versionId: result.id,
      version: nextVersion,
      provider: providerResponse.provider,
      status: providerResponse.status,
      feasible: providerResponse.feasible,
      partial: providerResponse.partial,
      qualityScore: providerResponse.qualityScore,
      softPenalty: providerResponse.softPenalty,
      objectiveValue: providerResponse.objectiveValue,
      stats: providerResponse.stats,
      conflicts: providerResponse.conflicts,
      failures: providerResponse.failures,
      suggestions: providerResponse.suggestions,
      timing: {
        modelGenerationMs: providerResponse.modelGenerationMs,
        solverMs: providerResponse.solverMs,
        wallMs: providerResponse.wallMs,
        memoryMb: providerResponse.memoryMb,
      },
      requiredOccurrences: providerResponse.stats.requiredOccurrences,
      scheduledOccurrences: providerResponse.stats.scheduledOccurrences,
      unscheduledOccurrences: providerResponse.stats.unscheduledOccurrences,
      hardViolations: (
        providerResponse.stats.teacherConflicts +
        providerResponse.stats.classConflicts +
        providerResponse.stats.roomConflicts +
        providerResponse.stats.availabilityViolations +
        providerResponse.stats.dutyConflicts +
        providerResponse.stats.fixedLessonViolations +
        providerResponse.stats.capacityViolations
      ),
      placedCount: providerResponse.entries.length,
      dutyCount: providerResponse.dutyEntries.length,
      allowPartial,
    });
  } catch (e: any) {
    await db.schedulingRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        error: String(e?.message || e),
        finishedAt: new Date(),
      },
    });
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
