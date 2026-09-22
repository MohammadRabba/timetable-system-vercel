import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// POST /api/timetable/redo { versionId } — re-apply the most recently undone change
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { versionId } = await req.json();
  const lastUndone = await db.timetableChange.findFirst({
    where: { versionId, undone: true },
    orderBy: { createdAt: "desc" },
  });
  if (!lastUndone) return NextResponse.json({ ok: false, message: "Nothing to redo" });

  const payload = JSON.parse(lastUndone.payload);
  if (lastUndone.action === "MOVE") {
    const to = payload.to;
    await db.timetableEntry.update({
      where: { id: payload.entryId },
      data: { day: to.day, period: to.period },
    });
  } else if (lastUndone.action === "SWAP") {
    const a = await db.timetableEntry.findUnique({ where: { id: payload.aId } });
    const b = await db.timetableEntry.findUnique({ where: { id: payload.bId } });
    if (a && b) {
      await db.$transaction([
        db.timetableEntry.update({ where: { id: payload.aId }, data: { day: payload.bFrom.day, period: payload.bFrom.period } }),
        db.timetableEntry.update({ where: { id: payload.bId }, data: { day: payload.aFrom.day, period: payload.aFrom.period } }),
      ]);
    }
  } else if (lastUndone.action === "LOCK" || lastUndone.action === "UNLOCK") {
    await db.timetableEntry.update({
      where: { id: payload.entryId },
      data: { locked: lastUndone.action === "LOCK" },
    });
  }

  await db.timetableChange.update({ where: { id: lastUndone.id }, data: { undone: false } });
  return NextResponse.json({ ok: true });
}
