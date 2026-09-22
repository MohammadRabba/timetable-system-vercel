import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/rooms?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const rooms = await db.room.findMany({
    where: { schoolId: schoolId || undefined },
    include: { _count: { select: { lessons: true, sections: true, timetableEntries: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ rooms });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const r = await db.room.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      name: body.name,
      code: body.code,
      type: body.type || "CLASSROOM",
      capacity: body.capacity ? Number(body.capacity) : 30,
      equipment: body.equipment || null,
      availablePeriods: body.availablePeriods || null,
      unavailablePeriods: body.unavailablePeriods || null,
    },
  });
  await audit({ userId: s.id, schoolId: r.schoolId, action: "CREATE_ROOM", entity: "Room", entityId: r.id, newValue: r });
  return NextResponse.json({ room: r });
}
