import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buildSolverInput } from "@/lib/scheduling/input-builder";
import { validateTimetable, type OccurrenceEntry } from "@/lib/scheduling/provider";
import type { SolverInput } from "@/lib/scheduling/engine";

// POST /api/scheduling/validate-timetable { schoolId, versionId }
// Runs the independent Python validator on the persisted timetable and
// returns the full validation report — never assumes the solver was correct.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  const versionId = body.versionId;
  if (!schoolId || !versionId) {
    return NextResponse.json({ error: "schoolId and versionId required" }, { status: 400 });
  }

  const input = await buildSolverInput(schoolId);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const dbEntries = await db.timetableEntry.findMany({
    where: { versionId, cellType: "TEACHING" },
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

  try {
    const report = await validateTimetable(input as SolverInput, occEntries);
    return NextResponse.json({ ...report, schoolId, versionId });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
