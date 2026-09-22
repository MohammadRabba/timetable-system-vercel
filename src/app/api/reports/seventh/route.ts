import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseDays } from "@/lib/scheduling/engine";

// GET /api/reports/seventh?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  if (!schoolId) return NextResponse.json({ items: [] });
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return NextResponse.json({ items: [] });
  const seventhPeriod = school.periodsPerDay;

  let versionId = url.searchParams.get("versionId");
  if (!versionId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ items: [], target: 0, deviation: 0 });

  const teachers = await db.teacher.findMany({ where: { schoolId } });
  const entries = await db.timetableEntry.findMany({ where: { versionId, period: seventhPeriod, cellType: "TEACHING" } });
  const counts: Record<string, number> = {};
  for (const t of teachers) counts[t.id] = 0;
  for (const e of entries) counts[e.teacherId || ""] = (counts[e.teacherId || ""] || 0) + 1;
  const values = Object.values(counts);
  const total = values.reduce((s, v) => s + v, 0);
  const target = teachers.length ? Math.round(total / teachers.length) : 0;
  const deviation = values.reduce((s, v) => s + Math.abs(v - target), 0);

  const items = teachers.map((t) => ({
    teacherId: t.id,
    teacherName: t.name,
    required: t.requiredSeventh,
    actual: counts[t.id] || 0,
    diff: (counts[t.id] || 0) - t.requiredSeventh,
  }));
  return NextResponse.json({ items, target, deviation });
}
