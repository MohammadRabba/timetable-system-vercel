import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = await db.teacher.findUnique({
    where: { id },
    include: {
      subjects: { include: { subject: true } },
      sections: { include: { section: { include: { grade: true } } } },
      availability: true,
      daysOff: true,
      preferences: true,
      _count: { select: { lessons: true, duties: true } },
    },
  });
  if (!t) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ teacher: t });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const t = await db.teacher.update({
    where: { id },
    data: {
      name: body.name,
      employeeNumber: body.employeeNumber,
      specialization: body.specialization,
      email: body.email,
      phone: body.phone,
      status: body.status,
      requiredWorkload: body.requiredWorkload ? Number(body.requiredWorkload) : undefined,
      maxDailyPeriods: body.maxDailyPeriods ? Number(body.maxDailyPeriods) : undefined,
      minDailyPeriods: body.minDailyPeriods ? Number(body.minDailyPeriods) : undefined,
      requiredSeventh: body.requiredSeventh ? Number(body.requiredSeventh) : undefined,
      maxSeventh: body.maxSeventh ? Number(body.maxSeventh) : undefined,
    },
  });
  return NextResponse.json({ teacher: t });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.teacher.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
