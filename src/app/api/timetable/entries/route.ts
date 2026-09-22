import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/timetable/entries?versionId=&teacherId=&sectionId=&roomId=&subjectId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const versionId = url.searchParams.get("versionId");
  const teacherId = url.searchParams.get("teacherId");
  const sectionId = url.searchParams.get("sectionId");
  const roomId = url.searchParams.get("roomId");
  const subjectId = url.searchParams.get("subjectId");

  // Determine version
  let vId = versionId || null;
  if (!vId && schoolId) {
    const current = await db.timetableVersion.findFirst({
      where: { schoolId, isCurrent: true },
      orderBy: { version: "desc" },
    });
    if (current) vId = current.id;
  }
  if (!vId) return NextResponse.json({ entries: [] });

  const entries = await db.timetableEntry.findMany({
    where: {
      versionId: vId,
      teacherId: teacherId || undefined,
      sectionId: sectionId || undefined,
      roomId: roomId || undefined,
      subjectId: subjectId || undefined,
    },
    include: { lesson: { include: { subject: true, teacher: true, section: true, room: true } }, duty: true },
  });

  return NextResponse.json({ entries, versionId: vId });
}

// POST /api/timetable/entries — create entry (manual)
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const e = await db.timetableEntry.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      versionId: body.versionId,
      lessonId: body.lessonId || null,
      dutyId: body.dutyId || null,
      teacherId: body.teacherId || null,
      sectionId: body.sectionId || null,
      subjectId: body.subjectId || null,
      roomId: body.roomId || null,
      day: body.day,
      period: Number(body.period),
      cellType: body.cellType || "TEACHING",
      locked: Boolean(body.locked),
    },
  });
  return NextResponse.json({ entry: e });
}
