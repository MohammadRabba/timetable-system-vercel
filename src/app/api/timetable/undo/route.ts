import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// POST /api/timetable/undo { versionId } — undo last non-undone change
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { versionId } = await req.json();
  const last = await db.timetableChange.findFirst({
    where: { versionId, undone: false },
    orderBy: { createdAt: "desc" },
  });
  if (!last) return NextResponse.json({ ok: false, message: "Nothing to undo" });

  const payload = JSON.parse(last.payload);
  // Reverse the action
  if (last.action === "MOVE") {
    const e = await db.timetableEntry.findUnique({ where: { id: payload.entryId } });
    if (e) {
      const from = payload.from;
      await db.timetableEntry.update({
        where: { id: payload.entryId },
        data: { day: from.day, period: from.period },
      });
    }
  } else if (last.action === "SWAP") {
    const a = await db.timetableEntry.findUnique({ where: { id: payload.aId } });
    const b = await db.timetableEntry.findUnique({ where: { id: payload.bId } });
    if (a && b) {
      await db.$transaction([
        db.timetableEntry.update({ where: { id: payload.aId }, data: { day: payload.aFrom.day, period: payload.aFrom.period } }),
        db.timetableEntry.update({ where: { id: payload.bId }, data: { day: payload.bFrom.day, period: payload.bFrom.period } }),
      ]);
    }
  } else if (last.action === "LOCK" || last.action === "UNLOCK") {
    await db.timetableEntry.update({
      where: { id: payload.entryId },
      data: { locked: last.action === "LOCK" ? false : true },
    });
  }

  await db.timetableChange.update({ where: { id: last.id }, data: { undone: true } });
  return NextResponse.json({ ok: true, undone: last.id });
}
