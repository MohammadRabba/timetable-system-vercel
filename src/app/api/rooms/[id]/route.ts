import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const r = await db.room.update({
    where: { id },
    data: {
      name: body.name,
      code: body.code,
      type: body.type,
      capacity: body.capacity !== undefined ? Number(body.capacity) : undefined,
      equipment: body.equipment,
      availablePeriods: body.availablePeriods,
      unavailablePeriods: body.unavailablePeriods,
    },
  });
  return NextResponse.json({ room: r });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.room.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
