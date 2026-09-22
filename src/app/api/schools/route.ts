import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/schools — list schools visible to current user
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  // SUPER_ADMIN sees all; others see only their own school
  const where = s.role === "SUPER_ADMIN" ? {} : { id: s.schoolId ?? "none" };
  const schools = await db.school.findMany({
    where,
    include: { currentYear: true, _count: { select: { teachers: true, sections: true, subjects: true, rooms: true, lessons: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ schools });
}

// POST /api/schools — create school
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const {
    name,
    principalName,
    address,
    phone,
    email,
    workingDays = "SUN,MON,TUE,WED,THU",
    periodsPerDay = 7,
    periodDuration = 45,
    breakDuration = 15,
    startTime = "07:30",
    endTime = "14:00",
    currentSemester = "First",
    rtl = true,
  } = body;

  if (!name) return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });

  const orgId = s.role === "SUPER_ADMIN"
    ? (await db.organization.findFirst())?.id ?? (await db.organization.create({ data: { name, code: name.slice(0, 8).toUpperCase() } })).id
    : (await db.user.findUnique({ where: { id: s.id } }))?.organizationId ?? null;

  if (!orgId) return NextResponse.json({ error: "NO_ORGANIZATION" }, { status: 400 });

  const school = await db.school.create({
    data: {
      organizationId: orgId,
      name,
      principalName,
      address,
      phone,
      email,
      workingDays,
      periodsPerDay: Number(periodsPerDay),
      periodDuration: Number(periodDuration),
      breakDuration: Number(breakDuration),
      startTime,
      endTime,
      currentSemester,
      rtl: Boolean(rtl),
    },
  });

  // Auto-create current academic year
  const year = await db.academicYear.create({
    data: {
      schoolId: school.id,
      name: "2026/2027",
      startDate: new Date("2026-09-01"),
      endDate: new Date("2027-06-30"),
      semesters: "First,Second",
      active: true,
    },
  });
  await db.school.update({ where: { id: school.id }, data: { currentYearId: year.id } });

  // Auto-create default periods based on periodsPerDay
  const periods: any[] = [];
  for (let i = 1; i <= periodsPerDay; i++) {
    periods.push({
      schoolId: school.id,
      yearId: year.id,
      order: i,
      label: i === periodsPerDay ? `Period ${i} (Seventh)` : `Period ${i}`,
      startTime: "07:30",
      endTime: "08:15",
      type: i === periodsPerDay ? "SEVENTH" : "TEACHING",
      isBreak: false,
    });
  }
  if (periods.length) await db.period.createMany({ data: periods });

  await audit({
    userId: s.id,
    schoolId: school.id,
    action: "CREATE_SCHOOL",
    entity: "School",
    entityId: school.id,
    newValue: { name: school.name, principalName: school.principalName },
  });

  return NextResponse.json({ school, year });
}
