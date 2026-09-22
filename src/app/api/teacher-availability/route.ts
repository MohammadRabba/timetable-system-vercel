import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/teacher-availability?teacherId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const teacherId = url.searchParams.get("teacherId");
  if (!teacherId) return NextResponse.json({ error: "teacherId required" }, { status: 400 });
  const availability = await db.teacherAvailability.findMany({ where: { teacherId } });
  const daysOff = await db.teacherDayOff.findMany({ where: { teacherId } });
  return NextResponse.json({ availability, daysOff });
}

// POST: { teacherId, slots: [{day, period, state}], daysOff: ["SUN", ...] } — overwrite
export async function POST(req: NextRequest) {
  const body = await req.json();
  const teacherId: string = body.teacherId;
  const slots: Array<{ day: string; period: number; state: string }> = body.slots || [];
  const daysOff: string[] = body.daysOff || [];

  if (!teacherId) return NextResponse.json({ error: "teacherId required" }, { status: 400 });

  await db.$transaction([
    db.teacherAvailability.deleteMany({ where: { teacherId } }),
    db.teacherDayOff.deleteMany({ where: { teacherId } }),
    ...slots.map((s) =>
      db.teacherAvailability.create({
        data: { teacherId, day: s.day, period: Number(s.period), state: s.state as any },
      })
    ),
    ...daysOff.map((d) => db.teacherDayOff.create({ data: { teacherId, day: d } })),
  ]);

  return NextResponse.json({ ok: true, slots: slots.length, daysOff: daysOff.length });
}
