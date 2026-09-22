import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/dashboard?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  if (!schoolId) return NextResponse.json({});

  const school = await db.school.findUnique({ where: { id: schoolId } });

  const [teacherCount, sectionCount, subjectCount, roomCount, lessonCount, dutyCount] = await Promise.all([
    db.teacher.count({ where: { schoolId } }),
    db.section.count({ where: { schoolId, active: true } }),
    db.subject.count({ where: { schoolId } }),
    db.room.count({ where: { schoolId } }),
    db.lesson.aggregate({ where: { schoolId }, _sum: { weeklyOccurrences: true } }),
    db.duty.count({ where: { schoolId } }),
  ]);

  const totalLessons = lessonCount._sum.weeklyOccurrences || 0;

  // Current version stats
  const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
  let scheduled = 0, conflicts = 0, qualityScore = 0;
  if (cur) {
    scheduled = await db.timetableEntry.count({ where: { versionId: cur.id, cellType: "TEACHING" } });
    const stats = cur.statistics ? JSON.parse(cur.statistics) : null;
    qualityScore = stats?.qualityScore ?? 0;
    // Compute conflicts dynamically
    const entries = await db.timetableEntry.findMany({ where: { versionId: cur.id } });
    const seen: Record<string, number> = {};
    for (const e of entries) {
      const keys = [
        `${e.day}_${e.period}_${e.teacherId}`,
        `${e.day}_${e.period}_${e.sectionId}`,
        ...(e.roomId ? [`${e.day}_${e.period}_${e.roomId}`] : []),
      ];
      for (const k of keys) seen[k] = (seen[k] || 0) + 1;
    }
    conflicts = Object.values(seen).filter((v) => v > 1).length;
  }

  // Recent runs
  const recentRuns = await db.schedulingRun.findMany({
    where: { schoolId },
    include: { version: true },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  return NextResponse.json({
    school,
    stats: {
      teachers: teacherCount,
      classes: sectionCount,
      subjects: subjectCount,
      rooms: roomCount,
      lessons: totalLessons,
      duties: dutyCount,
      scheduled,
      conflicts,
      qualityScore,
    },
    currentVersion: cur ? { id: cur.id, version: cur.version, name: cur.name, reason: cur.reason } : null,
    recentRuns: recentRuns.map((r) => ({
      id: r.id,
      status: r.status,
      mode: r.mode,
      progress: r.progress,
      qualityScore: r.result ? JSON.parse(r.result).qualityScore : null,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      version: r.version ? { id: r.version.id, version: r.version.version } : null,
    })),
  });
}
