import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const d = await db.duty.update({
    where: { id },
    data: {
      type: body.type,
      title: body.title,
      day: body.day,
      period: body.period !== undefined ? Number(body.period) : undefined,
      location: body.location,
      notes: body.notes,
    },
  });
  return NextResponse.json({ duty: d });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.duty.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
