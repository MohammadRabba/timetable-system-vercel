import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/schools/[id] — detailed school
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const school = await db.school.findUnique({
    where: { id },
    include: {
      currentYear: true,
      academicYears: true,
      periods: { orderBy: { order: "asc" } },
      _count: { select: { teachers: true, sections: true, subjects: true, rooms: true, lessons: true, duties: true, constraints: true } },
    },
  });
  if (!school) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ school });
}

// PUT /api/schools/[id] — update school
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const updated = await db.school.update({
    where: { id },
    data: {
      name: body.name,
      principalName: body.principalName,
      address: body.address,
      phone: body.phone,
      email: body.email,
      workingDays: body.workingDays,
      periodsPerDay: body.periodsPerDay ? Number(body.periodsPerDay) : undefined,
      periodDuration: body.periodDuration ? Number(body.periodDuration) : undefined,
      breakDuration: body.breakDuration ? Number(body.breakDuration) : undefined,
      startTime: body.startTime,
      endTime: body.endTime,
      currentSemester: body.currentSemester,
      rtl: body.rtl !== undefined ? Boolean(body.rtl) : undefined,
      logoUrl: body.logoUrl,
    },
  });
  return NextResponse.json({ school: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await db.school.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
