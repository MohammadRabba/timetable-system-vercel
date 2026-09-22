import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { parseDays, type DayCode } from "@/lib/scheduling/engine";

// GET /api/reports/conflicts?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  let versionId = url.searchParams.get("versionId");
  if (!versionId && schoolId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ conflicts: [] });

  const entries = await db.timetableEntry.findMany({
    where: { versionId },
    include: { lesson: { include: { teacher: true, subject: true, section: true } } },
  });

  const teacherMap: Record<string, any[]> = {};
  const classMap: Record<string, any[]> = {};
  const roomMap: Record<string, any[]> = {};
  for (const e of entries) {
    const k1 = `${e.day}_${e.period}_${e.teacherId}`;
    (teacherMap[k1] = teacherMap[k1] || []).push(e);
    const k2 = `${e.day}_${e.period}_${e.sectionId}`;
    (classMap[k2] = classMap[k2] || []).push(e);
    if (e.roomId) {
      const k3 = `${e.day}_${e.period}_${e.roomId}`;
      (roomMap[k3] = roomMap[k3] || []).push(e);
    }
  }

  const conflicts: any[] = [];
  for (const [k, list] of Object.entries(teacherMap)) {
    if (list.length > 1) {
      const [day, period] = k.split("_");
      conflicts.push({
        severity: "CRITICAL",
        type: "TEACHER",
        day,
        period: Number(period),
        message: `Teacher ${list[0].lesson?.teacher?.name || list[0].teacherId} double-booked at ${day} period ${period}`,
        entityIds: list.map((l) => l.id),
      });
    }
  }
  for (const [k, list] of Object.entries(classMap)) {
    if (list.length > 1) {
      const [day, period] = k.split("_");
      conflicts.push({
        severity: "CRITICAL",
        type: "CLASS",
        day,
        period: Number(period),
        message: `Class ${list[0].lesson?.section?.name || list[0].sectionId} has ${list.length} lessons at ${day} period ${period}`,
        entityIds: list.map((l) => l.id),
      });
    }
  }
  for (const [k, list] of Object.entries(roomMap)) {
    if (list.length > 1) {
      const [day, period] = k.split("_");
      conflicts.push({
        severity: "CRITICAL",
        type: "ROOM",
        day,
        period: Number(period),
        message: `Room ${list[0].roomId} double-booked at ${day} period ${period}`,
        entityIds: list.map((l) => l.id),
      });
    }
  }

  return NextResponse.json({ conflicts });
}
