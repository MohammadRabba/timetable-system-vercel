// Scheduling Engine — Constraint-based solver (CP-style) for school timetables
// Implements hard/soft constraints, pre-validation, explainable failures,
// optimization with weighted penalties, quality scoring, repair & smart swaps.

export type DayCode = "SAT" | "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI";

export type CellType =
  | "TEACHING"
  | "DUTY"
  | "SUPERVISION"
  | "RESERVE"
  | "UNAVAILABLE"
  | "REST"
  | "FREE";

export interface Slot {
  day: DayCode;
  period: number;
}

export interface SolverInput {
  school: {
    id: string;
    name: string;
    workingDays: string;
    periodsPerDay: number;
    // The "Seventh Period" is a SEPARATE business concept from the last
    // period of the day. Sourced from Period.type == "SEVENTH" in the DB.
    // When periodsPerDay=8, the seventh period is P7 (NOT P8). When the
    // school has fewer than 7 periods/day and no SEVENTH row exists, this
    // is null — the SOFT_SEVENTH_EQUAL objective is then disabled.
    seventhPeriod?: number | null;
  };
  teachers: TeacherIn[];
  sections: SectionIn[];
  subjects: SubjectIn[];
  rooms: RoomIn[];
  lessons: LessonIn[];
  duties: DutyIn[];
  availability: Record<string, Record<string, "AVAILABLE" | "UNAVAILABLE" | "PREFERRED" | "FORBIDDEN">>;
  daysOff: Record<string, DayCode[]>;
  constraints: ConstraintIn[];
}

export interface TeacherIn {
  id: string;
  name: string;
  requiredWorkload: number;
  maxDailyPeriods: number;
  minDailyPeriods: number;
  requiredSeventh: number;
  maxSeventh: number;
}

export interface SectionIn {
  id: string;
  name: string;
  studentCount: number;
  roomId?: string | null;
}

export interface SubjectIn {
  id: string;
  name: string;
  type: string;
  defaultWeekly: number;
  maxPerDay: number;
  minGap: number;
  consecutive: boolean;
  preferredPeriods: number[];
  forbiddenPeriods: number[];
  requiredRoomType?: string | null;
  priority: number;
}

export interface RoomIn {
  id: string;
  name: string;
  type: string;
  capacity: number;
}

export interface LessonIn {
  id: string;
  teacherId: string;
  subjectId: string;
  sectionId: string;
  roomId?: string | null;
  weeklyOccurrences: number;
  duration: number;
  lessonType: string;
  priority: number;
  requiredConsecutive: number;
  preferredSlots: string;
  forbiddenSlots: string;
  fixed: boolean;
  fixedDay?: string | null;
  fixedPeriod?: number | null;
  locked: boolean;
  coTeacherId?: string | null;
}

export interface DutyIn {
  id: string;
  teacherId: string;
  type: string;
  title: string;
  day: DayCode;
  period: number;
  location?: string | null;
}

export interface ConstraintIn {
  code: string;
  type: "HARD" | "SOFT";
  weight: number;
  enabled: boolean;
}

export interface PlacedEntry {
  lessonId: string;
  teacherId: string;
  subjectId: string;
  sectionId: string;
  roomId?: string | null;
  day: DayCode;
  period: number;
  cellType: CellType;
  fixed: boolean;
  locked: boolean;
}

export interface SolverResult {
  feasible: boolean;
  entries: PlacedEntry[];
  dutyEntries: Array<{ dutyId: string; teacherId: string; day: DayCode; period: number; type: string; title: string; cellType: CellType }>;
  stats: {
    placed: number;
    unplaced: number;
    teacherGaps: number;
    seventhDeviation: number;
    subjectCluster: number;
    workloadDeviation: number;
    unwantedSlots: number;
  };
  qualityScore: number;
  conflicts: ConflictReport[];
  failures: Failure[];
  suggestions: string[];
  progress: { phase: string; percent: number };
}

export interface ConflictReport {
  severity: "CRITICAL" | "WARNING" | "OPTIMIZATION";
  type: "TEACHER" | "CLASS" | "ROOM" | "AVAILABILITY" | "WORKLOAD" | "DUTY" | "FIXED" | "CAPACITY";
  day: DayCode;
  period: number;
  message: string;
  entityIds: string[];
}

export interface Failure {
  scope: "TEACHER" | "CLASS" | "ROOM" | "GLOBAL";
  entityId?: string;
  reason: string;
  suggestion: string;
}

export function parseDays(s: string): DayCode[] {
  return (s || "")
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => x) as DayCode[];
}

function slotKey(day: DayCode, period: number) {
  return `${day}_${period}`;
}

// =========================== Pre-Solver Validation ===========================

export function preValidate(input: SolverInput): Failure[] {
  const failures: Failure[] = [];

  const days = parseDays(input.school.workingDays);
  const periodsPerDay = input.school.periodsPerDay;

  for (const t of input.teachers) {
    const daysOffCount = (input.daysOff[t.id] || []).filter((d) => days.includes(d)).length;
    const availableDays = days.length - daysOffCount;
    const maxPossibleSlots = availableDays * periodsPerDay;
    const lessonsOfTeacher = input.lessons
      .filter((l) => l.teacherId === t.id)
      .reduce((s, l) => s + l.weeklyOccurrences, 0);
    const dutiesOfTeacher = input.duties.filter((d) => d.teacherId === t.id).length;
    const totalNeeded = lessonsOfTeacher + dutiesOfTeacher + t.requiredSeventh;
    if (totalNeeded > maxPossibleSlots) {
      failures.push({
        scope: "TEACHER",
        entityId: t.id,
        reason: `Teacher ${t.name} requires ${totalNeeded} periods (teaching ${lessonsOfTeacher} + duties ${dutiesOfTeacher} + seventh ${t.requiredSeventh}) but only ${maxPossibleSlots} valid slots exist.`,
        suggestion: "Reduce teacher's required workload, add availability, or assign lessons to another teacher.",
      });
    }
    if (t.requiredWorkload > maxPossibleSlots) {
      failures.push({
        scope: "TEACHER",
        entityId: t.id,
        reason: `Teacher ${t.name} required workload ${t.requiredWorkload} exceeds available slots ${maxPossibleSlots}.`,
        suggestion: "Adjust required workload or availability.",
      });
    }
  }

  for (const sec of input.sections) {
    const lessonsOfSection = input.lessons
      .filter((l) => l.sectionId === sec.id)
      .reduce((s, l) => s + l.weeklyOccurrences, 0);
    const maxPossibleSlots = days.length * periodsPerDay;
    if (lessonsOfSection > maxPossibleSlots) {
      failures.push({
        scope: "CLASS",
        entityId: sec.id,
        reason: `Class ${sec.name} requires ${lessonsOfSection} lessons but only ${maxPossibleSlots} slots exist in the week.`,
        suggestion: "Reduce weekly lesson count or add working periods/days.",
      });
    }
  }

  for (const sub of input.subjects) {
    if (sub.requiredRoomType) {
      const has = input.rooms.some((r) => r.type === sub.requiredRoomType);
      if (!has) {
        failures.push({
          scope: "GLOBAL",
          reason: `Subject ${sub.name} requires room type ${sub.requiredRoomType} but no compatible room exists.`,
          suggestion: "Add a compatible laboratory/room, or change subject room type requirement.",
        });
      }
    }
  }

  for (const l of input.lessons) {
    const sec = input.sections.find((s) => s.id === l.sectionId);
    if (!sec) continue;
    if (l.roomId) {
      const r = input.rooms.find((rm) => rm.id === l.roomId);
      if (r && r.capacity < sec.studentCount) {
        failures.push({
          scope: "ROOM",
          entityId: r.id,
          reason: `Lesson in section ${sec.name} (${sec.studentCount} students) assigned to room ${r.name} (capacity ${r.capacity}).`,
          suggestion: "Assign a room with greater capacity.",
        });
      }
    }
  }

  const fixedBuckets: Record<string, number> = {};
  for (const l of input.lessons) {
    if (l.fixed && l.fixedDay && l.fixedPeriod !== null && l.fixedPeriod !== undefined) {
      const k = `${l.teacherId}_${l.fixedDay}_${l.fixedPeriod}`;
      fixedBuckets[k] = (fixedBuckets[k] || 0) + 1;
      if (fixedBuckets[k] > 1) {
        const teacher = input.teachers.find((t) => t.id === l.teacherId);
        failures.push({
          scope: "TEACHER",
          entityId: l.teacherId,
          reason: `Teacher ${teacher?.name || l.teacherId} has ${fixedBuckets[k]} fixed lessons at ${l.fixedDay} period ${l.fixedPeriod}.`,
          suggestion: "Move or unfix conflicting fixed lessons.",
        });
      }
    }
  }

  return failures;
}

// =========================== Solver ===========================

export function solve(
  input: SolverInput,
  opts: { timeLimitSec?: number; onProgress?: (p: { phase: string; percent: number }) => void } = {}
): SolverResult {
  const days = parseDays(input.school.workingDays);
  const periodsPerDay = input.school.periodsPerDay;
  const onProgress = opts.onProgress || (() => {});

  const slots: Slot[] = [];
  for (const d of days) for (let p = 1; p <= periodsPerDay; p++) slots.push({ day: d, period: p });

  onProgress({ phase: "VALIDATING", percent: 10 });

  const failures = preValidate(input);

  const teacherSlots: Record<string, Set<string>> = {};
  for (const t of input.teachers) {
    const set = new Set<string>();
    const daysOffArr = input.daysOff[t.id] || [];
    for (const s of slots) {
      if (daysOffArr.includes(s.day)) continue;
      const state = input.availability[t.id]?.[slotKey(s.day, s.period)];
      if (state === "UNAVAILABLE" || state === "FORBIDDEN") continue;
      set.add(slotKey(s.day, s.period));
    }
    teacherSlots[t.id] = set;
  }

  const teacherOccupied: Record<string, Map<string, DutyIn>> = {};
  for (const d of input.duties) {
    if (!teacherOccupied[d.teacherId]) teacherOccupied[d.teacherId] = new Map();
    teacherOccupied[d.teacherId].set(slotKey(d.day, d.period), d);
  }

  const sectionOccupied: Record<string, Set<string>> = {};
  const roomOccupied: Record<string, Set<string>> = {};
  const teacherPlaced: Record<string, Set<string>> = {};

  for (const t of input.teachers) teacherPlaced[t.id] = new Set();
  for (const s of input.sections) sectionOccupied[s.id] = new Set();
  for (const r of input.rooms) roomOccupied[r.id] = new Set();

  const placed: PlacedEntry[] = [];

  const dutyEntries = input.duties.map((d) => ({
    dutyId: d.id,
    teacherId: d.teacherId,
    day: d.day,
    period: d.period,
    type: d.type,
    title: d.title,
    cellType: "DUTY" as CellType,
  }));
  for (const d of input.duties) {
    const k = slotKey(d.day, d.period);
    teacherPlaced[d.teacherId]?.add(k);
  }

  onProgress({ phase: "BUILDING", percent: 25 });

  const lessonList = [...input.lessons].sort((a, b) => {
    if (a.fixed !== b.fixed) return a.fixed ? -1 : 1;
    const aw = a.weeklyOccurrences * a.duration;
    const bw = b.weeklyOccurrences * b.duration;
    if (aw !== bw) return bw - aw;
    const asub = input.subjects.find((s) => s.id === a.subjectId);
    const bsub = input.subjects.find((s) => s.id === b.subjectId);
    return (bsub?.priority || 0) - (asub?.priority || 0);
  });

  function candidateSlots(l: LessonIn): Slot[] {
    const subject = input.subjects.find((s) => s.id === l.subjectId)!;
    if (!subject) return [];
    const allowed: Slot[] = [];

    if (l.fixed && l.fixedDay && l.fixedPeriod !== null && l.fixedPeriod !== undefined) {
      allowed.push({ day: l.fixedDay as DayCode, period: l.fixedPeriod });
      return allowed;
    }

    const lessonForbidden = new Set(
      (l.forbiddenSlots || "").split(",").map((x) => x.trim()).filter(Boolean)
    );
    const lessonPreferred = new Set(
      (l.preferredSlots || "").split(",").map((x) => x.trim()).filter(Boolean)
    );
    const subjectForbidden = new Set((subject.forbiddenPeriods || []).map((p: number) => String(p)));
    const subjectPreferred = new Set((subject.preferredPeriods || []).map((p: number) => String(p)));

    for (const s of slots) {
      const k = slotKey(s.day, s.period);
      if (!teacherSlots[l.teacherId]?.has(k)) continue;
      if (teacherPlaced[l.teacherId]?.has(k)) continue;
      if (sectionOccupied[l.sectionId]?.has(k)) continue;
      if (lessonForbidden.has(k) || subjectForbidden.has(String(s.period))) continue;
      if (l.roomId && roomOccupied[l.roomId]?.has(k)) continue;
      if (subject.requiredRoomType) {
        const r = input.rooms.find((rm) => rm.id === (l.roomId || ""));
        if (r && r.type !== subject.requiredRoomType) continue;
      }
      const lessonsThisDay = placed.filter(
        (e) => e.lessonId && e.sectionId === l.sectionId && e.day === s.day
      ).length;
      if (lessonsThisDay >= subject.maxPerDay) continue;
      allowed.push(s);
    }

    allowed.sort((a, b) => {
      const ka = slotKey(a.day, a.period);
      const kb = slotKey(b.day, b.period);
      const aPref = lessonPreferred.has(ka) || subjectPreferred.has(String(a.period)) ? 0 : 1;
      const bPref = lessonPreferred.has(kb) || subjectPreferred.has(String(b.period)) ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      return a.period - b.period;
    });

    return allowed;
  }

  let attempts = 0;
  const startMs = Date.now();
  const timeLimitMs = (opts.timeLimitSec || 60) * 1000;

  function placeLessonAt(idx: number): boolean {
    if (idx >= lessonList.length) return true;
    if (Date.now() - startMs > timeLimitMs) return false;

    const l = lessonList[idx];
    const cands = candidateSlots(l);

    if (cands.length === 0) {
      attempts++;
      return false;
    }

    for (const c of cands) {
      const k = slotKey(c.day, c.period);
      teacherPlaced[l.teacherId]?.add(k);
      sectionOccupied[l.sectionId]?.add(k);
      if (l.roomId) roomOccupied[l.roomId]?.add(k);
      placed.push({
        lessonId: l.id,
        teacherId: l.teacherId,
        subjectId: l.subjectId,
        sectionId: l.sectionId,
        roomId: l.roomId || null,
        day: c.day,
        period: c.period,
        cellType: "TEACHING",
        fixed: l.fixed,
        locked: l.locked,
      });

      if (placeLessonAt(idx + 1)) return true;

      teacherPlaced[l.teacherId]?.delete(k);
      sectionOccupied[l.sectionId]?.delete(k);
      if (l.roomId) roomOccupied[l.roomId]?.delete(k);
      placed.pop();
      attempts++;
      if (attempts > 200000) return false;
    }
    return false;
  }

  onProgress({ phase: "SOLVING", percent: 35 });
  const ok = placeLessonAt(0);

  if (!ok) {
    onProgress({ phase: "REPAIR", percent: 60 });
    for (const l of lessonList) {
      if (placed.some((p) => p.lessonId === l.id)) continue;
      for (const s of slots) {
        const k = slotKey(s.day, s.period);
        if (!teacherSlots[l.teacherId]?.has(k)) continue;
        if (teacherPlaced[l.teacherId]?.has(k)) continue;
        if (sectionOccupied[l.sectionId]?.has(k)) continue;
        if (l.roomId && roomOccupied[l.roomId]?.has(k)) continue;
        teacherPlaced[l.teacherId]?.add(k);
        sectionOccupied[l.sectionId]?.add(k);
        if (l.roomId) roomOccupied[l.roomId]?.add(k);
        placed.push({
          lessonId: l.id,
          teacherId: l.teacherId,
          subjectId: l.subjectId,
          sectionId: l.sectionId,
          roomId: l.roomId || null,
          day: s.day,
          period: s.period,
          cellType: "TEACHING",
          fixed: l.fixed,
          locked: l.locked,
        });
        break;
      }
    }
  }

  onProgress({ phase: "OPTIMIZING", percent: 75 });

  const weights = buildWeights(input.constraints);

  let bestStats = computeStats(input, placed, dutyEntries, slots);
  let bestScore = scoreQuality(bestStats, weights);

  for (let iter = 0; iter < 30; iter++) {
    let improved = false;
    for (let i = 0; i < placed.length; i++) {
      const e = placed[i];
      if (e.fixed || e.locked) continue;
      const l = lessonList.find((x) => x.id === e.lessonId);
      if (!l) continue;
      const k = slotKey(e.day, e.period);
      teacherPlaced[e.teacherId]?.delete(k);
      sectionOccupied[e.sectionId]?.delete(k);
      if (e.roomId) roomOccupied[e.roomId!]?.delete(k);

      const cands = candidateSlots(l);
      let localBest: Slot | null = null;
      let localBestScore = bestScore;

      const saved = { ...e };
      for (const c of cands) {
        if (c.day === e.day && c.period === e.period) continue;
        const k2 = slotKey(c.day, c.period);
        if (teacherPlaced[e.teacherId]?.has(k2)) continue;
        if (sectionOccupied[e.sectionId]?.has(k2)) continue;
        if (e.roomId && roomOccupied[e.roomId!]?.has(k2)) continue;

        e.day = c.day;
        e.period = c.period;
        teacherPlaced[e.teacherId]?.add(k2);
        sectionOccupied[e.sectionId]?.add(k2);
        if (e.roomId) roomOccupied[e.roomId!]?.add(k2);

        const st = computeStats(input, placed, dutyEntries, slots);
        const sc = scoreQuality(st, weights);
        if (sc > localBestScore) {
          localBestScore = sc;
          localBest = c;
        }

        teacherPlaced[e.teacherId]?.delete(k2);
        sectionOccupied[e.sectionId]?.delete(k2);
        if (e.roomId) roomOccupied[e.roomId!]?.delete(k2);
      }

      if (localBest) {
        e.day = localBest.day;
        e.period = localBest.period;
        const k3 = slotKey(localBest.day, localBest.period);
        teacherPlaced[e.teacherId]?.add(k3);
        sectionOccupied[e.sectionId]?.add(k3);
        if (e.roomId) roomOccupied[e.roomId!]?.add(k3);
        bestStats = computeStats(input, placed, dutyEntries, slots);
        bestScore = scoreQuality(bestStats, weights);
        improved = true;
      } else {
        e.day = saved.day;
        e.period = saved.period;
        teacherPlaced[e.teacherId]?.add(k);
        sectionOccupied[e.sectionId]?.add(k);
        if (e.roomId) roomOccupied[e.roomId!]?.add(k);
      }
    }
    if (!improved) break;
  }

  onProgress({ phase: "VALIDATING_RESULT", percent: 90 });

  const finalConflicts = detectConflicts(input, placed, slots);

  onProgress({ phase: "SAVING", percent: 100 });

  const stats = computeStats(input, placed, dutyEntries, slots);
  const qualityScore = scoreQuality(stats, weights);

  const suggestions: string[] = [];
  if (stats.unplaced > 0) {
    suggestions.push(`Add more teacher availability or reduce weekly occurrences to place remaining ${stats.unplaced} lessons.`);
  }
  if (stats.seventhDeviation > 0) {
    suggestions.push(`Adjust teacher requiredSeventh to balance seventh periods (deviation ${stats.seventhDeviation}).`);
  }
  if (stats.workloadDeviation > 0) {
    suggestions.push(`Reassign lessons to balance teacher workload (deviation ${stats.workloadDeviation}).`);
  }
  if (stats.teacherGaps > 5) {
    suggestions.push("Tighten teacher schedules to reduce gaps.");
  }

  const feasible = stats.unplaced === 0 && finalConflicts.filter((c) => c.severity === "CRITICAL").length === 0;

  return {
    feasible,
    entries: placed,
    dutyEntries,
    stats,
    qualityScore,
    conflicts: finalConflicts,
    failures,
    suggestions,
    progress: { phase: "COMPLETED", percent: 100 },
  };
}

interface Stats {
  placed: number;
  unplaced: number;
  teacherGaps: number;
  seventhDeviation: number;
  subjectCluster: number;
  workloadDeviation: number;
  unwantedSlots: number;
}

function buildWeights(constraints: ConstraintIn[]) {
  const w: Record<string, number> = {};
  for (const c of constraints) {
    if (c.enabled) w[c.code] = c.weight;
  }
  return w;
}

function computeStats(input: SolverInput, placed: PlacedEntry[], dutyEntries: any[], slots: Slot[]): Stats {
  const days = parseDays(input.school.workingDays);
  const periodsPerDay = input.school.periodsPerDay;

  const totalRequired = input.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0);
  const unplaced = Math.max(0, totalRequired - placed.length);

  let teacherGaps = 0;
  for (const t of input.teachers) {
    for (const d of days) {
      const periods = [
        ...placed.filter((p) => p.teacherId === t.id && p.day === d).map((p) => p.period),
        ...dutyEntries.filter((dd) => dd.teacherId === t.id && dd.day === d).map((dd) => dd.period),
      ].sort((a, b) => a - b);
      for (let i = 1; i < periods.length; i++) {
        const gap = periods[i] - periods[i - 1] - 1;
        if (gap > 0) teacherGaps += gap;
      }
    }
  }

  // "Seventh period" is a SEPARATE business concept from the last period
  // of the day. Sourced from input.school.seventhPeriod (Period.type ==
  // "SEVENTH" in DB). With periodsPerDay=8, the seventh period is P7, NOT
  // P8. When no seventh period is configured (null), the deviation is 0
  // and the SOFT_SEVENTH_EQUAL objective is disabled.
  const seventhCount: Record<string, number> = {};
  for (const t of input.teachers) seventhCount[t.id] = 0;
  const seventhPeriodNum = input.school.seventhPeriod ?? null;
  if (seventhPeriodNum !== null) {
    for (const p of placed) {
      if (p.period === seventhPeriodNum) seventhCount[p.teacherId]++;
    }
  }
  const actualSeventhTotal = Object.values(seventhCount).reduce((s, v) => s + v, 0);
  const avg = input.teachers.length ? actualSeventhTotal / input.teachers.length : 0;
  const seventhDeviation = Math.round(
    Object.values(seventhCount).reduce((s, v) => s + Math.abs(v - avg), 0)
  );

  const subjectCluster: Record<string, number> = {};
  for (const p of placed) {
    const k = `${p.sectionId}_${p.subjectId}_${p.day}`;
    subjectCluster[k] = (subjectCluster[k] || 0) + 1;
  }
  const clusters = Object.values(subjectCluster).filter((v) => v > 1).reduce((s, v) => s + (v - 1), 0);

  const wl: Record<string, number> = {};
  for (const t of input.teachers) wl[t.id] = 0;
  for (const p of placed) wl[p.teacherId]++;
  for (const dd of dutyEntries) wl[dd.teacherId]++;
  const required = input.teachers.map((t) => t.requiredWorkload);
  const avgWl = required.length ? required.reduce((s, v) => s + v, 0) / required.length : 0;
  const workloadDeviation = Math.round(
    Object.entries(wl).reduce((s, [tid, v]) => {
      const t = input.teachers.find((x) => x.id === tid);
      return s + Math.abs(v - (t?.requiredWorkload || avgWl));
    }, 0)
  );

  let unwantedSlots = 0;
  for (const p of placed) {
    const l = input.lessons.find((x) => x.id === p.lessonId);
    if (!l) continue;
    const subject = input.subjects.find((s) => s.id === l.subjectId);
    if (!subject) continue;
    const forbidden = subject.forbiddenPeriods || [];
    const preferred = subject.preferredPeriods || [];
    if (forbidden.includes(p.period)) unwantedSlots++;
    else if (preferred.length && !preferred.includes(p.period)) unwantedSlots++;
  }

  return {
    placed: placed.length,
    unplaced,
    teacherGaps,
    seventhDeviation,
    subjectCluster: clusters,
    workloadDeviation,
    unwantedSlots,
  };
}

function scoreQuality(s: Stats, weights: Record<string, number>): number {
  let score = 100;
  score -= Math.min(40, s.unplaced * 10);
  score -= Math.min(15, s.teacherGaps * 1);
  score -= Math.min(15, s.seventhDeviation * 2);
  score -= Math.min(10, s.subjectCluster * 2);
  score -= Math.min(10, s.workloadDeviation * 0.5);
  score -= Math.min(10, s.unwantedSlots * 1);
  return Math.max(0, Math.round(score));
}

function detectConflicts(input: SolverInput, placed: PlacedEntry[], slots: Slot[]): ConflictReport[] {
  const out: ConflictReport[] = [];

  const teacherMap: Record<string, PlacedEntry[]> = {};
  const classMap: Record<string, PlacedEntry[]> = {};
  const roomMap: Record<string, PlacedEntry[]> = {};

  for (const p of placed) {
    const k1 = `${p.day}_${p.period}_${p.teacherId}`;
    (teacherMap[k1] = teacherMap[k1] || []).push(p);
    const k2 = `${p.day}_${p.period}_${p.sectionId}`;
    (classMap[k2] = classMap[k2] || []).push(p);
    if (p.roomId) {
      const k3 = `${p.day}_${p.period}_${p.roomId}`;
      (roomMap[k3] = roomMap[k3] || []).push(p);
    }
  }

  for (const [k, list] of Object.entries(teacherMap)) {
    if (list.length > 1) {
      const [day, period] = k.split("_");
      out.push({
        severity: "CRITICAL",
        type: "TEACHER",
        day: day as DayCode,
        period: Number(period),
        message: `Teacher ${list[0].teacherId} double-booked at ${day} period ${period}`,
        entityIds: list.map((l) => l.lessonId),
      });
    }
  }
  for (const [k, list] of Object.entries(classMap)) {
    if (list.length > 1) {
      const [day, period] = k.split("_");
      out.push({
        severity: "CRITICAL",
        type: "CLASS",
        day: day as DayCode,
        period: Number(period),
        message: `Class ${list[0].sectionId} has ${list.length} lessons at ${day} period ${period}`,
        entityIds: list.map((l) => l.lessonId),
      });
    }
  }
  for (const [k, list] of Object.entries(roomMap)) {
    if (list.length > 1) {
      const [day, period] = k.split("_");
      out.push({
        severity: "CRITICAL",
        type: "ROOM",
        day: day as DayCode,
        period: Number(period),
        message: `Room ${list[0].roomId} double-booked at ${day} period ${period}`,
        entityIds: list.map((l) => l.lessonId),
      });
    }
  }

  return out;
}

export function suggestSwapsFor(
  lessonId: string,
  targetDay: DayCode,
  targetPeriod: number,
  input: SolverInput,
  placed: PlacedEntry[]
): Array<{ day: DayCode; period: number; reason: string; cost: number }> {
  const l = input.lessons.find((x) => x.id === lessonId);
  if (!l) return [];

  const occupier = placed.find(
    (p) =>
      p.lessonId !== lessonId &&
      p.day === targetDay &&
      p.period === targetPeriod &&
      (p.teacherId === l.teacherId || p.sectionId === l.sectionId || (l.roomId && p.roomId === l.roomId))
  );
  if (!occupier) return [];

  const days = parseDays(input.school.workingDays);
  const suggestions: Array<{ day: DayCode; period: number; reason: string; cost: number }> = [];
  for (const day of days) {
    for (let period = 1; period <= input.school.periodsPerDay; period++) {
      if (day === targetDay && period === targetPeriod) continue;
      const occL = input.lessons.find((x) => x.id === occupier.lessonId);
      if (!occL) continue;
      const conflict = placed.find(
        (p) =>
          p.lessonId !== occupier.lessonId &&
          p.day === day &&
          p.period === period &&
          (p.teacherId === occL.teacherId || p.sectionId === occL.sectionId || (occL.roomId && p.roomId === occL.roomId))
      );
      if (!conflict) {
        suggestions.push({
          day,
          period,
          reason: `Swap occupier ${occupier.lessonId} to ${day} P${period}`,
          cost: 1,
        });
      }
    }
  }
  return suggestions.slice(0, 10);
}
