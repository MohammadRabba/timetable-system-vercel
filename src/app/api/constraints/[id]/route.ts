import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const c = await db.constraint.update({
    where: { id },
    data: {
      name: body.name,
      type: body.type,
      weight: body.weight !== undefined ? Number(body.weight) : undefined,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      params: body.params,
    },
  });
  return NextResponse.json({ constraint: c });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.constraint.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
