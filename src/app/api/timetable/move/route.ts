import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";
import { buildSolverInput } from "@/lib/scheduling/input-builder";
import { suggestSwaps as providerSuggestSwaps, type OccurrenceEntry } from "@/lib/scheduling/provider";
import type { SolverInput } from "@/lib/scheduling/engine";

// POST /api/timetable/move { entryId, day, period, versionId, allowSwap }
// Validates hard constraints before applying. Returns ok/conflict.
// If the target slot is occupied and `allowSwap` is true, returns swap
// suggestions from the OR-Tools swap engine.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const entryId = body.entryId;
  const newDay = body.day;
  const newPeriod = Number(body.period);
  const versionId = body.versionId;
  const allowSwap = body.allowSwap !== false; // default true

  const entry = await db.timetableEntry.findUnique({
    where: { id: entryId },
    include: { lesson: { include: { subject: true, teacher: true, section: true, room: true } } },
  });
  if (!entry) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
  if (entry.locked) return NextResponse.json({ error: "ENTRY_LOCKED" }, { status: 409 });

  // Check for conflicts at target slot (same version, same teacher / section / room)
  const conflicts = await db.timetableEntry.findMany({
    where: {
      versionId: versionId || entry.versionId,
      id: { not: entry.id },
      day: newDay,
      period: newPeriod,
      OR: [
        { teacherId: entry.teacherId || undefined },
        { sectionId: entry.sectionId || undefined },
        { roomId: entry.roomId || undefined },
      ],
    },
    include: { lesson: { include: { subject: true, teacher: true, section: true, room: true } } },
  });

  if (conflicts.length > 0) {
    // Target slot occupied — return conflict + swap suggestions if requested
    let swapSuggestions: any[] = [];
    if (allowSwap) {
      try {
        const schoolId = entry.schoolId;
        const input = await buildSolverInput(schoolId);
        if (!("error" in input)) {
          // Build current entries list from DB
          const dbEntries = await db.timetableEntry.findMany({
            where: { versionId: versionId || entry.versionId, cellType: "TEACHING" },
            include: { lesson: true },
          });
          const occEntries: OccurrenceEntry[] = dbEntries.map((e, i) => ({
            occurrenceId: `${e.lessonId || "x"}#${i + 1}`,
            lessonId: e.lessonId || "",
            occurrenceNumber: i + 1,
            teacherId: e.teacherId || "",
            subjectId: e.subjectId || "",
            sectionId: e.sectionId || "",
            roomId: e.roomId || null,
            day: e.day,
            period: e.period,
            cellType: e.cellType,
            fixed: false,
            locked: e.locked,
          }));
          const swapResp = await providerSuggestSwaps(
            input as SolverInput,
            occEntries,
            { occurrenceId: `${entry.lessonId || "x"}#1`, day: newDay, period: newPeriod }
          );
          swapSuggestions = swapResp.suggestions || [];
        }
      } catch (e: any) {
        // Swap engine unavailable — return conflict without suggestions
      }
    }
    return NextResponse.json({
      ok: false,
      conflict: true,
      conflicts: conflicts.map((c) => ({
        id: c.id,
        type: c.teacherId === entry.teacherId ? "TEACHER" : c.sectionId === entry.sectionId ? "CLASS" : "ROOM",
        message: `Target slot ${newDay} P${newPeriod} already has ${conflicts.length} conflict(s).`,
      })),
      swapSuggestions,
    });
  }

  // Apply move
  const old = { day: entry.day, period: entry.period };
  const updated = await db.timetableEntry.update({
    where: { id: entryId },
    data: { day: newDay, period: newPeriod },
  });

  // Record change history (for undo/redo)
  await db.timetableChange.create({
    data: {
      versionId: versionId || entry.versionId,
      action: "MOVE",
      payload: JSON.stringify({ entryId, from: old, to: { day: newDay, period: newPeriod } }),
    },
  });

  await audit({
    userId: s.id,
    schoolId: entry.schoolId,
    action: "MOVE_ENTRY",
    entity: "TimetableEntry",
    entityId: entryId,
    oldValue: old,
    newValue: { day: newDay, period: newPeriod },
  });

  return NextResponse.json({ ok: true, entry: updated });
}
