import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.json();
  const old = await db.grade.findUnique({ where: { id } });
  const g = await db.grade.update({
    where: { id },
    data: {
      stage: body.stage,
      name: body.name,
      order: body.order !== undefined ? Number(body.order) : undefined,
    },
  });
  await audit({ userId: s.id, schoolId: g.schoolId, action: "UPDATE_GRADE", entity: "Grade", entityId: g.id, oldValue: old, newValue: g });
  return NextResponse.json({ grade: g });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await ctx.params;
  const g = await db.grade.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await db.grade.delete({ where: { id } });
  await audit({ userId: s.id, schoolId: g.schoolId, action: "DELETE_GRADE", entity: "Grade", entityId: id, oldValue: g });
  return NextResponse.json({ ok: true });
}
