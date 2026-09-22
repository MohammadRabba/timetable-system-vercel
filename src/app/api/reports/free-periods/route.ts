import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseDays, type DayCode } from "@/lib/scheduling/engine";

// GET /api/reports/free-periods?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  if (!schoolId) return NextResponse.json({ items: [] });

  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return NextResponse.json({ items: [] });
  const days = parseDays(school.workingDays);
  const periods = school.periodsPerDay;

  let versionId = url.searchParams.get("versionId");
  if (!versionId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ items: [] });

  const teachers = await db.teacher.findMany({ where: { schoolId } });
  const entries = await db.timetableEntry.findMany({ where: { versionId } });

  const items = teachers.map((t) => {
    const freeSlots: string[] = [];
    for (const d of days) {
      for (let p = 1; p <= periods; p++) {
        const e = entries.find((x) => x.teacherId === t.id && x.day === d && x.period === p);
        if (!e) freeSlots.push(`${d}-P${p}`);
      }
    }
    return {
      teacherId: t.id,
      teacherName: t.name,
      freeCount: freeSlots.length,
      freeSlots,
    };
  });
  return NextResponse.json({ items });
}
