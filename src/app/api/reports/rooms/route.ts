import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseDays } from "@/lib/scheduling/engine";

// GET /api/reports/rooms?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  if (!schoolId) return NextResponse.json({ items: [] });
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return NextResponse.json({ items: [] });
  const days = parseDays(school.workingDays);
  const periods = school.periodsPerDay;
  const totalSlots = days.length * periods;

  let versionId = url.searchParams.get("versionId");
  if (!versionId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ items: [] });

  const rooms = await db.room.findMany({ where: { schoolId } });
  const entries = await db.timetableEntry.findMany({ where: { versionId, roomId: { not: null } } });

  const items = rooms.map((r) => {
    const used = entries.filter((e) => e.roomId === r.id).length;
    return {
      roomId: r.id,
      roomName: r.name,
      type: r.type,
      capacity: r.capacity,
      used,
      totalSlots,
      utilization: totalSlots ? Math.round((used / totalSlots) * 100) : 0,
    };
  });
  return NextResponse.json({ items });
}
