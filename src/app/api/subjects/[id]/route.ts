import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const sub = await db.subject.update({
    where: { id },
    data: {
      name: body.name,
      code: body.code,
      type: body.type,
      defaultWeekly: body.defaultWeekly ? Number(body.defaultWeekly) : undefined,
      maxPerDay: body.maxPerDay ? Number(body.maxPerDay) : undefined,
      minGap: body.minGap ? Number(body.minGap) : undefined,
      consecutive: body.consecutive !== undefined ? Boolean(body.consecutive) : undefined,
      requiredConsecutive: body.requiredConsecutive !== undefined ? Number(body.requiredConsecutive) : undefined,
      preferredPeriods: body.preferredPeriods,
      forbiddenPeriods: body.forbiddenPeriods,
      requiredRoomType: body.requiredRoomType,
      requiredEquipment: body.requiredEquipment,
      priority: body.priority ? Number(body.priority) : undefined,
      color: body.color,
    },
  });
  return NextResponse.json({ subject: sub });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.subject.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
