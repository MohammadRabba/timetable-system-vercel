// SchedulingProvider abstraction.
//
// The TypeScript solver remains available as a reference / fallback.
// The default production provider is ORToolsSolver, which delegates to the
// Python + FastAPI + OR-Tools CP-SAT microservice at port 3040.

import type { SolverInput, SolverResult } from "./engine";
import { solve as tsSolve } from "./engine";

export type SolverStatus =
  | "OPTIMAL"
  | "FEASIBLE"
  | "INFEASIBLE"
  | "UNKNOWN"
  | "MODEL_INVALID";

export interface OccurrenceEntry {
  occurrenceId: string; // "lessonId#n"
  lessonId: string;
  occurrenceNumber: number; // 1..N
  teacherId: string;
  subjectId: string;
  sectionId: string;
  roomId?: string | null;
  day: string;
  period: number;
  cellType: string;
  fixed: boolean;
  locked: boolean;
}

export interface ProviderStats {
  requiredOccurrences: number;
  scheduledOccurrences: number;
  unscheduledOccurrences: number;
  teacherConflicts: number;
  classConflicts: number;
  roomConflicts: number;
  availabilityViolations: number;
  dutyConflicts: number;
  fixedLessonViolations: number;
  capacityViolations: number;
  teacherGaps: number;
  seventhDeviation: number;
  subjectCluster: number;
  workloadDeviation: number;
  unwantedSlots: number;
}

export interface ProviderResponse {
  status: SolverStatus;
  feasible: boolean; // STRICT: true iff required == scheduled AND hardViolations == 0
  partial: boolean; // True only when allowPartial && some unscheduled
  entries: OccurrenceEntry[];
  dutyEntries: Array<{
    dutyId: string;
    teacherId: string;
    day: string;
    period: number;
    type: string;
    title: string;
    cellType: string;
  }>;
  stats: ProviderStats;
  softPenalty: number;
  qualityScore: number;
  objectiveValue?: number | null;
  modelGenerationMs: number;
  solverMs: number;
  wallMs: number;
  memoryMb?: number | null;
  failures: Array<{
    scope: string;
    entityId?: string;
    reason: string;
    suggestion: string;
  }>;
  conflicts: Array<{
    type: string;
    severity: string;
    day?: string;
    period?: number;
    message: string;
    entityIds: string[];
  }>;
  suggestions: string[];
  provider: "TYPESCRIPT" | "OR_TOOLS";
}

export interface SolveOptions {
  timeLimitSeconds?: number;
  numWorkers?: number;
  profile?: "FAST" | "BALANCED" | "DEEP";
  allowPartial?: boolean;
}

export interface SchedulingProvider {
  name: string;
  solve(input: SolverInput, opts: SolveOptions): Promise<ProviderResponse>;
}

// ============== TypeScriptSolver (fallback/reference) ==============

export const TypeScriptSolver: SchedulingProvider = {
  name: "TypeScriptSolver",
  async solve(input: SolverInput, opts: SolveOptions = {}): Promise<ProviderResponse> {
    const t0 = Date.now();
    const result = tsSolve(input, {
      timeLimitSec: opts.timeLimitSeconds || 60,
    });

    // Convert TS result into the unified ProviderResponse schema.
    // The TS solver does not expand weekly occurrences, so this is best-effort
    // for backward compatibility. The new strict success criteria make this
    // solver's output rarely `feasible: true` for production data.
    const requiredOccurrences = input.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0);
    const scheduledOccurrences = result.entries.length;
    const hardViolations = result.conflicts.filter((c) => c.severity === "CRITICAL").length;

    return {
      status: result.feasible ? "FEASIBLE" : "UNKNOWN",
      feasible: result.feasible && scheduledOccurrences === requiredOccurrences && hardViolations === 0,
      partial: false, // TS solver does not produce partial solutions
      entries: result.entries.map((e) => ({
        occurrenceId: `${e.lessonId}#1`,
        lessonId: e.lessonId,
        occurrenceNumber: 1,
        teacherId: e.teacherId,
        subjectId: e.subjectId,
        sectionId: e.sectionId,
        roomId: e.roomId || null,
        day: e.day,
        period: e.period,
        cellType: e.cellType,
        fixed: e.fixed,
        locked: e.locked,
      })),
      dutyEntries: result.dutyEntries,
      stats: {
        requiredOccurrences,
        scheduledOccurrences,
        unscheduledOccurrences: Math.max(0, requiredOccurrences - scheduledOccurrences),
        teacherConflicts: result.conflicts.filter((c) => c.type === "TEACHER").length,
        classConflicts: result.conflicts.filter((c) => c.type === "CLASS").length,
        roomConflicts: result.conflicts.filter((c) => c.type === "ROOM").length,
        availabilityViolations: result.conflicts.filter((c) => c.type === "AVAILABILITY").length,
        dutyConflicts: result.conflicts.filter((c) => c.type === "DUTY").length,
        fixedLessonViolations: result.conflicts.filter((c) => c.type === "FIXED").length,
        capacityViolations: result.conflicts.filter((c) => c.type === "CAPACITY").length,
        teacherGaps: result.stats.teacherGaps,
        seventhDeviation: result.stats.seventhDeviation,
        subjectCluster: result.stats.subjectCluster,
        workloadDeviation: result.stats.workloadDeviation,
        unwantedSlots: result.stats.unwantedSlots,
      },
      softPenalty: 0,
      qualityScore: result.qualityScore,
      objectiveValue: null,
      modelGenerationMs: 0,
      solverMs: 0,
      wallMs: Date.now() - t0,
      memoryMb: null,
      failures: result.failures,
      conflicts: result.conflicts,
      suggestions: result.suggestions,
      provider: "TYPESCRIPT",
    };
  },
};

// ============== ORToolsSolver (production) ==============

// In production (Vercel), SCHEDULER_URL is empty — calls go to the in-deployment
// Python Function at /api/scheduler. In local dev, SCHEDULER_URL points to the
// standalone uvicorn server at http://127.0.0.1:3040.
const SCHEDULER_URL = process.env.SCHEDULER_URL || "";
const SCHEDULER_SECRET = process.env.SCHEDULER_SECRET || "";
const SCHEDULER_BASE = SCHEDULER_URL || "/api/scheduler";

function _schedulerUrl(path: string): string {
  // path is like "/solve" or "/validate" — no leading prefix when SCHEDULER_URL
  // is set (calls http://127.0.0.1:3040/solve). When using the in-deployment
  // function, the path is /api/scheduler/solve.
  if (SCHEDULER_URL) {
    return `${SCHEDULER_URL}${path}`;
  }
  return `${SCHEDULER_BASE}${path}`;
}

function _schedulerHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SCHEDULER_SECRET) {
    h["X-Scheduler-Secret"] = SCHEDULER_SECRET;
  }
  return h;
}

export const ORToolsSolver: SchedulingProvider = {
  name: "ORToolsSolver",
  async solve(input: SolverInput, opts: SolveOptions = {}): Promise<ProviderResponse> {
    const t0 = Date.now();
    const profile = opts.profile || "BALANCED";
    const timeLimit = opts.timeLimitSeconds
      ?? (profile === "FAST" ? 10 : profile === "DEEP" ? 300 : 60);

    // Build the request body matching the Python SolverRequest schema
    const body = {
      school: input.school,
      teachers: input.teachers,
      sections: input.sections,
      subjects: input.subjects.map((s) => ({
        ...s,
        preferredPeriods: s.preferredPeriods,
        forbiddenPeriods: s.forbiddenPeriods,
      })),
      rooms: input.rooms,
      lessons: input.lessons,
      duties: input.duties,
      availability: input.availability,
      daysOff: input.daysOff,
      constraints: input.constraints,
      config: {
        timeLimitSeconds: timeLimit,
        numWorkers: opts.numWorkers ?? 8,
        profile,
        allowPartial: opts.allowPartial ?? false,
      },
    };

    const controller = new AbortController();
    const timeoutMs = (timeLimit + 30) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let r: Response;
    try {
      r = await fetch(_schedulerUrl("/solve"), {
        method: "POST",
        headers: _schedulerHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      const cause = e?.cause ? ` (cause: ${e.cause.code || e.cause.message || e.cause})` : "";
      throw new Error(`OR-Tools solver call failed: ${e?.message || e}${cause} (url=${_schedulerUrl("/solve")})`);
    }
    clearTimeout(timer);
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`OR-Tools solver call failed: ${r.status} ${err}`);
    }
    const data = await r.json();
    return {
      status: data.status,
      feasible: data.feasible,
      partial: data.partial,
      entries: data.entries,
      dutyEntries: data.dutyEntries,
      stats: data.stats,
      softPenalty: data.softPenalty,
      qualityScore: data.qualityScore,
      objectiveValue: data.objectiveValue ?? null,
      modelGenerationMs: data.modelGenerationMs,
      solverMs: data.solverMs,
      wallMs: data.wallMs ?? (Date.now() - t0),
      memoryMb: data.memoryMb ?? null,
      failures: data.failures,
      conflicts: data.conflicts,
      suggestions: data.suggestions,
      provider: "OR_TOOLS",
    };
  },
};

// ============== Default provider selection ==============

export function getDefaultProvider(): SchedulingProvider {
  // OR-Tools is the production default. Override via env SCHEDULER_PROVIDER=typescript
  // to use the TS reference solver (for testing/comparison).
  const wanted = (process.env.SCHEDULER_PROVIDER || "ortools").toLowerCase();
  return wanted === "typescript" ? TypeScriptSolver : ORToolsSolver;
}

// ============== Independent validator call ==============

export async function validateTimetable(input: SolverInput, entries: OccurrenceEntry[]): Promise<{
  valid: boolean;
  hardViolations: number;
  softPenalty: number;
  issues: any[];
  stats: ProviderStats;
}> {
  const body = {
    school: input.school,
    teachers: input.teachers,
    sections: input.sections,
    subjects: input.subjects.map((s) => ({
      ...s,
      preferredPeriods: s.preferredPeriods,
      forbiddenPeriods: s.forbiddenPeriods,
    })),
    rooms: input.rooms,
    lessons: input.lessons,
    duties: input.duties,
    availability: input.availability,
    daysOff: input.daysOff,
    entries,
    dutyEntries: [],
  };
  const r = await fetch(_schedulerUrl("/validate"), {
    method: "POST",
    headers: _schedulerHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Validator call failed: ${r.status}`);
  return r.json();
}

// ============== Swap suggestion call ==============

export async function suggestSwaps(input: SolverInput, entries: OccurrenceEntry[], target: {
  occurrenceId: string;
  day: string;
  period: number;
}): Promise<{ suggestions: Array<{ day: string; period: number; swapWithLessonId?: string; swapWithOccurrenceId?: string; reason: string; hardViolations: number; softPenalty: number }> }> {
  const body = {
    school: input.school,
    teachers: input.teachers,
    sections: input.sections,
    subjects: input.subjects.map((s) => ({
      ...s,
      preferredPeriods: s.preferredPeriods,
      forbiddenPeriods: s.forbiddenPeriods,
    })),
    rooms: input.rooms,
    lessons: input.lessons,
    duties: input.duties,
    availability: input.availability,
    daysOff: input.daysOff,
    entries,
    targetOccurrenceId: target.occurrenceId,
    targetDay: target.day,
    targetPeriod: target.period,
  };
  const r = await fetch(_schedulerUrl("/swap"), {
    method: "POST",
    headers: _schedulerHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Swap call failed: ${r.status}`);
  return r.json();
}
