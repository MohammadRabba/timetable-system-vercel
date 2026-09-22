import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/duties?schoolId=&teacherId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const teacherId = url.searchParams.get("teacherId");
  const duties = await db.duty.findMany({
    where: { schoolId: schoolId || undefined, teacherId: teacherId || undefined },
    include: { teacher: true },
    orderBy: [{ day: "asc" }, { period: "asc" }],
  });
  return NextResponse.json({ duties });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const d = await db.duty.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      teacherId: body.teacherId,
      type: body.type || "DUTY",
      title: body.title,
      day: body.day,
      period: Number(body.period),
      location: body.location || null,
      notes: body.notes || null,
    },
  });
  await audit({ userId: s.id, schoolId: d.schoolId, action: "CREATE_DUTY", entity: "Duty", entityId: d.id, newValue: d });
  return NextResponse.json({ duty: d });
}
