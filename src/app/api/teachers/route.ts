import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/teachers?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const teachers = await db.teacher.findMany({
    where: { schoolId: schoolId || undefined },
    include: {
      subjects: { include: { subject: true } },
      sections: { include: { section: true } },
      _count: { select: { lessons: true, duties: true, availability: true, daysOff: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ teachers });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const t = await db.teacher.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      name: body.name,
      employeeNumber: body.employeeNumber,
      specialization: body.specialization || null,
      email: body.email || null,
      phone: body.phone || null,
      status: body.status || "ACTIVE",
      requiredWorkload: body.requiredWorkload ? Number(body.requiredWorkload) : 24,
      maxDailyPeriods: body.maxDailyPeriods ? Number(body.maxDailyPeriods) : 7,
      minDailyPeriods: body.minDailyPeriods ? Number(body.minDailyPeriods) : 0,
      requiredSeventh: body.requiredSeventh ? Number(body.requiredSeventh) : 0,
      maxSeventh: body.maxSeventh ? Number(body.maxSeventh) : 3,
    },
  });
  await audit({ userId: s.id, schoolId: t.schoolId, action: "CREATE_TEACHER", entity: "Teacher", entityId: t.id, newValue: t });
  return NextResponse.json({ teacher: t });
}
