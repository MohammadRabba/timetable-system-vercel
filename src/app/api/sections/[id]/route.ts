import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const sec = await db.section.update({
    where: { id },
    data: {
      name: body.name,
      code: body.code,
      studentCount: body.studentCount !== undefined ? Number(body.studentCount) : undefined,
      roomId: body.roomId || null,
      branchId: body.branchId || null,
      active: body.active !== undefined ? Boolean(body.active) : undefined,
    },
  });
  return NextResponse.json({ section: sec });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.section.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
