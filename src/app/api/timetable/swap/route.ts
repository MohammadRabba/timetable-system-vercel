import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// POST /api/timetable/swap { entryAId, entryBId, versionId }
// Swaps two entries' day/period, validating hard constraints before applying.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const aId = body.entryAId;
  const bId = body.entryBId;
  const versionId = body.versionId;

  const a = await db.timetableEntry.findUnique({ where: { id: aId } });
  const b = await db.timetableEntry.findUnique({ where: { id: bId } });
  if (!a || !b) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });
  if (a.locked || b.locked) return NextResponse.json({ error: "ENTRY_LOCKED" }, { status: 409 });

  // Detect any conflict at target slot for A at B's slot and vice versa
  const othersAtB = await db.timetableEntry.findMany({
    where: {
      versionId,
      id: { notIn: [a.id, b.id] },
      day: b.day,
      period: b.period,
      OR: [
        { teacherId: a.teacherId || undefined },
        { sectionId: a.sectionId || undefined },
        { roomId: a.roomId || undefined },
      ],
    },
  });
  const othersAtA = await db.timetableEntry.findMany({
    where: {
      versionId,
      id: { notIn: [a.id, b.id] },
      day: a.day,
      period: a.period,
      OR: [
        { teacherId: b.teacherId || undefined },
        { sectionId: b.sectionId || undefined },
        { roomId: b.roomId || undefined },
      ],
    },
  });
  if (othersAtB.length > 0 || othersAtA.length > 0) {
    return NextResponse.json({ ok: false, conflict: true, message: "Swap would create conflict." });
  }

  // Swap
  await db.$transaction([
    db.timetableEntry.update({ where: { id: a.id }, data: { day: b.day, period: b.period } }),
    db.timetableEntry.update({ where: { id: b.id }, data: { day: a.day, period: a.period } }),
  ]);
  await db.timetableChange.create({
    data: {
      versionId,
      action: "SWAP",
      payload: JSON.stringify({ aId, bId, aFrom: { day: a.day, period: a.period }, bFrom: { day: b.day, period: b.period } }),
    },
  });

  await audit({
    userId: s.id,
    schoolId: a.schoolId,
    action: "SWAP_ENTRIES",
    entity: "TimetableEntry",
    entityId: a.id,
    newValue: { aId, bId },
  });

  return NextResponse.json({ ok: true });
}
