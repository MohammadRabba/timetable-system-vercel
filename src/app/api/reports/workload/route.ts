import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/reports/workload?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  let versionId = url.searchParams.get("versionId");
  if (!versionId && schoolId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ items: [] });

  const teachers = await db.teacher.findMany({
    where: { schoolId: schoolId || undefined },
    include: { _count: { select: { lessons: true, duties: true } } },
  });
  const entries = await db.timetableEntry.findMany({
    where: { versionId },
    include: { lesson: true, duty: true },
  });
  const daysOffMap: Record<string, number> = {};
  const tAvail = await db.teacherDayOff.groupBy({
    by: ["teacherId"],
    where: { teacher: { schoolId: schoolId || undefined } },
    _count: true,
  });
  for (const t of tAvail) daysOffMap[t.teacherId] = t._count;

  const items = teachers.map((t) => {
    const teaching = entries.filter((e) => e.teacherId === t.id && e.cellType === "TEACHING").length;
    const duties = entries.filter((e) => e.teacherId === t.id && ["DUTY", "SUPERVISION", "RESERVE"].includes(e.cellType)).length;
    const seventh = entries.filter((e) => e.teacherId === t.id && e.cellType === "TEACHING" && e.period === 7).length;
    return {
      teacherId: t.id,
      teacherName: t.name,
      required: t.requiredWorkload,
      teaching,
      duties,
      reserve: entries.filter((e) => e.teacherId === t.id && e.cellType === "RESERVE").length,
      total: teaching + duties,
      remaining: Math.max(0, t.requiredWorkload - (teaching + duties)),
      seventh,
      maxDaily: t.maxDailyPeriods,
      daysOff: daysOffMap[t.id] || 0,
    };
  });
  return NextResponse.json({ items });
}
