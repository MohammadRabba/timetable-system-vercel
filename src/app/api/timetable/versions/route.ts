import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/timetable/versions?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const versions = await db.timetableVersion.findMany({
    where: { schoolId: schoolId || undefined },
    orderBy: { version: "desc" },
    take: 50,
  });
  return NextResponse.json({ versions });
}

// POST /api/timetable/versions — create empty version or duplicate
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });

  const maxV = await db.timetableVersion.aggregate({
    where: { schoolId },
    _max: { version: true },
  });
  const nextVersion = (maxV._max.version || 0) + 1;

  // Set previous current to false
  await db.timetableVersion.updateMany({
    where: { schoolId, isCurrent: true },
    data: { isCurrent: false },
  });

  const v = await db.timetableVersion.create({
    data: {
      schoolId,
      version: nextVersion,
      name: body.name || `Version ${nextVersion}`,
      reason: body.reason || "Manual",
      createdBy: s.id,
      isCurrent: true,
    },
  });

  // Optionally duplicate entries from source version
  if (body.fromVersionId) {
    const src = await db.timetableEntry.findMany({ where: { versionId: body.fromVersionId } });
    if (src.length) {
      await db.timetableEntry.createMany({
        data: src.map((e) => ({
          schoolId,
          versionId: v.id,
          lessonId: e.lessonId,
          dutyId: e.dutyId,
          teacherId: e.teacherId,
          sectionId: e.sectionId,
          subjectId: e.subjectId,
          roomId: e.roomId,
          day: e.day,
          period: e.period,
          cellType: e.cellType,
          locked: e.locked,
        })),
      });
    }
  }

  return NextResponse.json({ version: v });
}
