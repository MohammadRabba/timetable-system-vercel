import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/subjects?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const subjects = await db.subject.findMany({
    where: { schoolId: schoolId || undefined },
    include: { _count: { select: { lessons: true, teacherSubjects: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ subjects });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const sub = await db.subject.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      name: body.name,
      code: body.code,
      type: body.type || "THEORY",
      defaultWeekly: body.defaultWeekly ? Number(body.defaultWeekly) : 0,
      maxPerDay: body.maxPerDay ? Number(body.maxPerDay) : 2,
      minGap: body.minGap ? Number(body.minGap) : 0,
      consecutive: Boolean(body.consecutive),
      requiredConsecutive: body.requiredConsecutive ? Number(body.requiredConsecutive) : 0,
      preferredPeriods: body.preferredPeriods || "",
      forbiddenPeriods: body.forbiddenPeriods || "",
      requiredRoomType: body.requiredRoomType || null,
      requiredEquipment: body.requiredEquipment || null,
      priority: body.priority ? Number(body.priority) : 100,
      color: body.color || null,
    },
  });
  await audit({ userId: s.id, schoolId: sub.schoolId, action: "CREATE_SUBJECT", entity: "Subject", entityId: sub.id, newValue: sub });
  return NextResponse.json({ subject: sub });
}
