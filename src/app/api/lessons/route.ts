import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/lessons?schoolId=&sectionId=&teacherId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const sectionId = url.searchParams.get("sectionId");
  const teacherId = url.searchParams.get("teacherId");
  const lessons = await db.lesson.findMany({
    where: {
      schoolId: schoolId || undefined,
      sectionId: sectionId || undefined,
      teacherId: teacherId || undefined,
    },
    include: {
      teacher: true,
      subject: true,
      section: { include: { grade: true, branch: true } },
      room: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ lessons });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const l = await db.lesson.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      yearId: body.yearId || null,
      teacherId: body.teacherId,
      subjectId: body.subjectId,
      sectionId: body.sectionId,
      roomId: body.roomId || null,
      weeklyOccurrences: body.weeklyOccurrences ? Number(body.weeklyOccurrences) : 1,
      duration: body.duration ? Number(body.duration) : 1,
      lessonType: body.lessonType || body.type || "THEORY",
      priority: body.priority ? Number(body.priority) : 100,
      requiredConsecutive: body.requiredConsecutive ? Number(body.requiredConsecutive) : 0,
      preferredSlots: body.preferredSlots || null,
      forbiddenSlots: body.forbiddenSlots || null,
      fixed: Boolean(body.fixed),
      fixedDay: body.fixedDay || null,
      fixedPeriod: body.fixedPeriod !== undefined ? Number(body.fixedPeriod) : null,
      locked: Boolean(body.locked),
      coTeacherId: body.coTeacherId || null,
    },
  });
  await audit({ userId: s.id, schoolId: l.schoolId, action: "CREATE_LESSON", entity: "Lesson", entityId: l.id, newValue: l });
  return NextResponse.json({ lesson: l });
}
