// Shared solver input builder — extracted from /api/scheduling/validate/route.ts
// so both the TS solver and the new OR-Tools provider can use it without
// circular imports.

import { db } from "@/lib/db";
import type { SolverInput, DayCode } from "@/lib/scheduling/engine";

export async function buildSolverInput(schoolId: string): Promise<SolverInput | { error: string }> {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (!school) return { error: "SCHOOL_NOT_FOUND" };

  const teachers = await db.teacher.findMany({
    where: { schoolId },
    include: { availability: true, daysOff: true },
  });
  const sections = await db.section.findMany({ where: { schoolId, active: true } });
  const subjects = await db.subject.findMany({ where: { schoolId } });
  const rooms = await db.room.findMany({ where: { schoolId } });
  const lessons = await db.lesson.findMany({ where: { schoolId } });
  const duties = await db.duty.findMany({ where: { schoolId } });
  const customConstraints = await db.constraint.findMany({ where: { schoolId } });

  // Look up the "Seventh Period" — the period whose `type == "SEVENTH"` in
  // the DB Period table. This is a SEPARATE business concept from the last
  // period of the day. With periodsPerDay=8, period 7 is the Seventh (and
  // period 8 is just the last regular teaching period). The solver uses
  // this to drive the SOFT_SEVENTH_EQUAL objective and the validator uses
  // it for the seventhDeviation stat.
  const seventhPeriodRow = await db.period.findFirst({
    where: { schoolId, type: "SEVENTH" },
  });
  const seventhPeriod = seventhPeriodRow?.order ?? null;

  const availability: SolverInput["availability"] = {};
  for (const t of teachers) {
    availability[t.id] = {};
    for (const a of t.availability) {
      availability[t.id][`${a.day}_${a.period}`] = a.state as any;
    }
  }
  const daysOff: SolverInput["daysOff"] = {};
  for (const t of teachers) {
    daysOff[t.id] = t.daysOff.map((d) => d.day as DayCode);
  }

  const defaultConstraints = [
    { code: "HARD_TEACHER_CONFLICT", name: "Teacher conflict", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_CLASS_CONFLICT", name: "Class conflict", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_ROOM_CONFLICT", name: "Room conflict", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_TEACHER_AVAILABILITY", name: "Teacher availability", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_TEACHER_DAY_OFF", name: "Teacher day off", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_WEEKLY_LESSONS", name: "Required weekly lessons", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_ROOM_COMPATIBILITY", name: "Room compatibility", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_CAPACITY", name: "Room capacity", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_DUTY_CONFLICT", name: "Duty conflict", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "HARD_FIXED_LESSONS", name: "Fixed lessons", type: "HARD" as const, weight: 1000000, enabled: true },
    { code: "SOFT_BALANCED_SUBJECTS", name: "Balanced subjects", type: "SOFT" as const, weight: 100, enabled: true },
    { code: "SOFT_WORKLOAD_BALANCE", name: "Workload balance", type: "SOFT" as const, weight: 1000, enabled: true },
    { code: "SOFT_SEVENTH_EQUAL", name: "Seventh equalization", type: "SOFT" as const, weight: 500, enabled: true },
    { code: "SOFT_MIN_TEACHER_GAPS", name: "Minimize teacher gaps", type: "SOFT" as const, weight: 100, enabled: true },
    { code: "SOFT_NO_REPEAT_SAME_DAY", name: "Avoid same subject same day", type: "SOFT" as const, weight: 100, enabled: true },
    { code: "SOFT_PREFERRED_PERIODS", name: "Preferred periods", type: "SOFT" as const, weight: 100, enabled: true },
    { code: "SOFT_SPREAD_LESSONS", name: "Spread lessons", type: "SOFT" as const, weight: 10, enabled: true },
    { code: "SOFT_MAX_DAILY_LESSONS", name: "Max daily lessons", type: "SOFT" as const, weight: 100, enabled: true },
  ];
  const map = new Map(customConstraints.map((c) => [c.code, c]));
  const constraints = defaultConstraints.map((d) => {
    const c = map.get(d.code);
    return {
      ...d,
      weight: c?.weight ?? d.weight,
      enabled: c?.enabled ?? true,
    };
  });

  return {
    school: {
      id: school.id,
      name: school.name,
      workingDays: school.workingDays,
      periodsPerDay: school.periodsPerDay,
      seventhPeriod,
    },
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.name,
      requiredWorkload: t.requiredWorkload,
      maxDailyPeriods: t.maxDailyPeriods,
      minDailyPeriods: t.minDailyPeriods,
      requiredSeventh: t.requiredSeventh,
      maxSeventh: t.maxSeventh,
    })),
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      studentCount: s.studentCount,
      roomId: s.roomId,
    })),
    subjects: subjects.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      defaultWeekly: s.defaultWeekly,
      maxPerDay: s.maxPerDay,
      minGap: s.minGap,
      consecutive: s.consecutive,
      preferredPeriods: (s.preferredPeriods || "").split(",").map((x) => Number(x.trim())).filter((x) => x),
      forbiddenPeriods: (s.forbiddenPeriods || "").split(",").map((x) => Number(x.trim())).filter((x) => x),
      requiredRoomType: s.requiredRoomType,
      priority: s.priority,
    })),
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      capacity: r.capacity,
    })),
    lessons: lessons.map((l) => ({
      id: l.id,
      teacherId: l.teacherId,
      subjectId: l.subjectId,
      sectionId: l.sectionId,
      roomId: l.roomId,
      weeklyOccurrences: l.weeklyOccurrences,
      duration: l.duration,
      lessonType: l.lessonType,
      priority: l.priority,
      requiredConsecutive: l.requiredConsecutive,
      preferredSlots: l.preferredSlots || "",
      forbiddenSlots: l.forbiddenSlots || "",
      fixed: l.fixed,
      fixedDay: l.fixedDay,
      fixedPeriod: l.fixedPeriod,
      locked: l.locked,
      coTeacherId: l.coTeacherId,
    })),
    duties: duties.map((d) => ({
      id: d.id,
      teacherId: d.teacherId,
      type: d.type,
      title: d.title,
      day: d.day as DayCode,
      period: d.period,
      location: d.location,
    })),
    availability,
    daysOff,
    constraints,
  };
}
