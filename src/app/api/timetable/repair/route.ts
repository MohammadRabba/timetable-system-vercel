import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";
import { buildSolverInput } from "@/lib/scheduling/input-builder";
import type { SolverInput, DayCode } from "@/lib/scheduling/engine";
import type { OccurrenceEntry } from "@/lib/scheduling/provider";

// POST /api/timetable/repair
// Body: {
//   versionId: string,
//   changedLessonOccurrenceId: string,
//   targetDay: number | string,    // 0-based index into workingDays OR day code "MON"
//   targetPeriod: number,
//   targetRoomId?: string | null,
//   repairRadius?: number,         // default 2
// }
//
// Calls the Python /repair endpoint with the persisted timetable + the
// full solver input, returns the proposed repair (does NOT commit).
// The UI shows the proposed changes; user must POST /api/timetable/move
// or /api/timetable/entries to commit them.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const versionId = body.versionId;
  const changedOccurrenceId = body.changedLessonOccurrenceId;
  const targetPeriod = Number(body.targetPeriod);
  const targetRoomId = body.targetRoomId ?? null;
  const repairRadius = Number(body.repairRadius ?? 2);

  // Convert targetDay to string day code
  let targetDay: string = body.targetDay;
  if (typeof targetDay === "number") {
    const school = await db.school.findFirst();
    if (!school) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });
    const days = (school.workingDays || "SUN,MON,TUE,WED,THU").split(",").map(d => d.trim()).filter(Boolean);
    targetDay = days[targetDay] || days[0];
  }

  if (!versionId || !changedOccurrenceId || !targetDay || !targetPeriod) {
    return NextResponse.json({ error: "MISSING_PARAM",
      detail: "versionId, changedLessonOccurrenceId, targetDay, targetPeriod are required" },
      { status: 400 });
  }

  // Build the full solver input (school config, teachers, sections, ...)
  const schoolId = s.schoolId || (await db.timetableVersion.findUnique({ where: { id: versionId } }))?.schoolId;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });
  const input = await buildSolverInput(schoolId);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 500 });

  // Load the persisted TimetableEntry rows for this version — these are the
  // current entries the user wants to repair from.
  const dbEntries = await db.timetableEntry.findMany({
    where: { versionId, cellType: "TEACHING" },
  });
  // Convert to PlacedEntry format expected by the Python service
  const entries: OccurrenceEntry[] = dbEntries.map((e) => {
    // Derive occurrence ID: stored as `${lessonId}#${occurrenceNumber}`
    // We need occurrenceNumber — we can derive from the lesson's weeklyOccurrences
    // by counting how many entries exist for the same lessonId before this one.
    return {
      occurrenceId: e.lessonId ? `${e.lessonId}#${e.id.slice(-6)}` : `duty-${e.id}`,
      lessonId: e.lessonId || "",
      occurrenceNumber: 0, // Python service doesn't strictly need this — used only for display
      teacherId: e.teacherId || "",
      subjectId: e.subjectId || "",
      sectionId: e.sectionId || "",
      roomId: e.roomId || null,
      day: e.day as string,
      period: e.period,
      cellType: e.cellType,
      fixed: false,
      locked: Boolean(e.locked),
    };
  });

  // Actually, the occurrenceId stored from the original solver was
  // `${lessonId}#${occurrenceNumber}` (e.g. "L1#3"). We don't store
  // occurrenceNumber on the TimetableEntry row — but we can reconstruct
  // it by indexing the entries per lessonId in their natural order.
  const perLessonIndex: Record<string, number> = {};
  for (const e of entries) {
    if (!e.lessonId) continue;
    perLessonIndex[e.lessonId] = (perLessonIndex[e.lessonId] || 0) + 1;
    e.occurrenceId = `${e.lessonId}#${perLessonIndex[e.lessonId]}`;
    e.occurrenceNumber = perLessonIndex[e.lessonId];
  }

  // Build the Python /repair request body
  const requestBody = {
    school: (input as SolverInput).school,
    teachers: (input as SolverInput).teachers,
    sections: (input as SolverInput).sections,
    subjects: (input as SolverInput).subjects.map((s) => ({
      ...s,
      preferredPeriods: s.preferredPeriods,
      forbiddenPeriods: s.forbiddenPeriods,
    })),
    rooms: (input as SolverInput).rooms,
    lessons: (input as SolverInput).lessons,
    duties: (input as SolverInput).duties,
    availability: (input as SolverInput).availability,
    daysOff: (input as SolverInput).daysOff,
    entries,
    movedOccurrenceId: changedOccurrenceId,
    newDay: targetDay,
    newPeriod: targetPeriod,
    newRoomId: targetRoomId,
    repairRadius,
    config: { timeLimitSeconds: 10, numWorkers: 4, profile: "FAST", allowPartial: false },
  };

  const SCHEDULER_URL = process.env.SCHEDULER_URL || "";
  const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET || "";
  const SCHEDULER_BASE = SCHEDULER_URL || "/api/scheduler";
  const repairUrl = SCHEDULER_URL ? `${SCHEDULER_URL}/repair` : `${SCHEDULER_BASE}/repair`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SCHEDULER_SECRET) {
    headers["X-Scheduler-Secret"] = SCHEDULER_SECRET;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let r: Response;
  try {
    r = await fetch(repairUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    return NextResponse.json(
      { error: "SCHEDULER_UNREACHABLE", detail: String(e?.message || e) },
      { status: 502 }
    );
  }
  clearTimeout(timer);
  if (!r.ok) {
    const txt = await r.text();
    return NextResponse.json({ error: "REPAIR_FAILED", detail: txt }, { status: 502 });
  }
  const data = await r.json();
  // data has: status, feasible, entries (full repaired timetable),
  // changes (list of moves), stats, conflicts, repaired, numMovedLessons,
  // message, profile
  return NextResponse.json({
    ok: data.feasible && data.repaired,
    status: data.status,
    feasible: data.feasible,
    repaired: data.repaired,
    changes: data.changes,         // what actually moved
    numMovedLessons: data.numMovedLessons,
    message: data.message,
    conflicts: data.conflicts,
    stats: data.stats,
    profile: data.profile,
    // NOTE: the full repaired `entries` is also returned, but the UI should
    // NOT auto-commit. The user must click "Apply" to call
    // /api/timetable/move for each change.
    proposedEntries: data.entries,
  });
}
