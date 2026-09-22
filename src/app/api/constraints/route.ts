import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/constraints?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  // Built-in constraints (not stored) merged with school custom overrides
  const defaults = [
    { code: "HARD_TEACHER_CONFLICT", name: "Teacher conflict", type: "HARD", weight: 1000000 },
    { code: "HARD_CLASS_CONFLICT", name: "Class conflict", type: "HARD", weight: 1000000 },
    { code: "HARD_ROOM_CONFLICT", name: "Room conflict", type: "HARD", weight: 1000000 },
    { code: "HARD_TEACHER_AVAILABILITY", name: "Teacher availability", type: "HARD", weight: 1000000 },
    { code: "HARD_TEACHER_DAY_OFF", name: "Teacher day off", type: "HARD", weight: 1000000 },
    { code: "HARD_WEEKLY_LESSONS", name: "Required weekly lessons", type: "HARD", weight: 1000000 },
    { code: "HARD_ROOM_COMPATIBILITY", name: "Room compatibility (labs)", type: "HARD", weight: 1000000 },
    { code: "HARD_CAPACITY", name: "Room capacity", type: "HARD", weight: 1000000 },
    { code: "HARD_DUTY_CONFLICT", name: "Duty conflict", type: "HARD", weight: 1000000 },
    { code: "HARD_FIXED_LESSONS", name: "Fixed lessons", type: "HARD", weight: 1000000 },
    { code: "SOFT_BALANCED_SUBJECTS", name: "Balanced subject distribution", type: "SOFT", weight: 100 },
    { code: "SOFT_WORKLOAD_BALANCE", name: "Balanced teacher workload", type: "SOFT", weight: 1000 },
    { code: "SOFT_SEVENTH_EQUAL", name: "Equalized seventh periods", type: "SOFT", weight: 500 },
    { code: "SOFT_MIN_TEACHER_GAPS", name: "Minimize teacher gaps", type: "SOFT", weight: 100 },
    { code: "SOFT_NO_REPEAT_SAME_DAY", name: "Avoid repeated subject in same day", type: "SOFT", weight: 100 },
    { code: "SOFT_PREFERRED_PERIODS", name: "Respect preferred periods", type: "SOFT", weight: 100 },
    { code: "SOFT_SPREAD_LESSONS", name: "Spread lessons through week", type: "SOFT", weight: 10 },
    { code: "SOFT_MAX_DAILY_LESSONS", name: "Avoid too many lessons in one day", type: "SOFT", weight: 100 },
  ];
  const custom = await db.constraint.findMany({ where: { schoolId: schoolId || undefined } });
  const map = new Map(custom.map((c) => [c.code, c]));
  const merged = defaults.map((d) => {
    const c = map.get(d.code);
    return {
      ...d,
      id: c?.id || null,
      enabled: c?.enabled ?? true,
      weight: c?.weight ?? d.weight,
      params: c?.params || null,
    };
  });
  return NextResponse.json({ constraints: merged });
}

// POST: update-or-create one constraint { schoolId, code, name, type, weight, enabled, params }
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });
  const c = await db.constraint.upsert({
    where: { schoolId_code: { schoolId, code: body.code } },
    create: {
      schoolId,
      code: body.code,
      name: body.name,
      type: body.type || "HARD",
      weight: Number(body.weight) ?? 1000000,
      enabled: body.enabled ?? true,
      params: body.params || null,
    },
    update: {
      name: body.name,
      weight: body.weight !== undefined ? Number(body.weight) : undefined,
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      params: body.params,
    },
  });
  return NextResponse.json({ constraint: c });
}
