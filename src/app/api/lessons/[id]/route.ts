import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const l = await db.lesson.update({
    where: { id },
    data: {
      teacherId: body.teacherId,
      subjectId: body.subjectId,
      sectionId: body.sectionId,
      roomId: body.roomId || null,
      weeklyOccurrences: body.weeklyOccurrences ? Number(body.weeklyOccurrences) : undefined,
      duration: body.duration ? Number(body.duration) : undefined,
      lessonType: body.lessonType,
      priority: body.priority ? Number(body.priority) : undefined,
      requiredConsecutive: body.requiredConsecutive !== undefined ? Number(body.requiredConsecutive) : undefined,
      preferredSlots: body.preferredSlots,
      forbiddenSlots: body.forbiddenSlots,
      fixed: body.fixed !== undefined ? Boolean(body.fixed) : undefined,
      fixedDay: body.fixedDay,
      fixedPeriod: body.fixedPeriod !== undefined ? Number(body.fixedPeriod) : undefined,
      locked: body.locked !== undefined ? Boolean(body.locked) : undefined,
      coTeacherId: body.coTeacherId || null,
    },
  });
  return NextResponse.json({ lesson: l });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.lesson.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
