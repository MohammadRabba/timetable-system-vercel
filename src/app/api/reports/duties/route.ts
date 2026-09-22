import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/reports/duties?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  if (!schoolId) return NextResponse.json({ items: [] });
  let versionId = url.searchParams.get("versionId");
  if (!versionId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ items: [] });

  const entries = await db.timetableEntry.findMany({
    where: { versionId, cellType: { in: ["DUTY", "SUPERVISION", "RESERVE"] } },
    include: { duty: true, teacher: true },
  });

  const items = entries.map((e) => ({
    id: e.id,
    teacherId: e.teacherId,
    teacherName: e.teacher?.name || "",
    type: e.duty?.type || e.cellType,
    title: e.duty?.title || "",
    day: e.day,
    period: e.period,
    location: e.duty?.location || null,
  }));
  return NextResponse.json({ items });
}
