import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/sections?schoolId=&gradeId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const gradeId = url.searchParams.get("gradeId");
  const sections = await db.section.findMany({
    where: {
      schoolId: schoolId || undefined,
      gradeId: gradeId || undefined,
    },
    include: {
      grade: true,
      branch: true,
      room: true,
      _count: { select: { students: true, lessons: true } },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ sections });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const sec = await db.section.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      yearId: body.yearId || null,
      gradeId: body.gradeId,
      branchId: body.branchId || null,
      name: body.name,
      code: body.code,
      studentCount: body.studentCount ? Number(body.studentCount) : 0,
      roomId: body.roomId || null,
      active: body.active !== undefined ? Boolean(body.active) : true,
    },
  });
  await audit({ userId: s.id, schoolId: sec.schoolId, action: "CREATE_SECTION", entity: "Section", entityId: sec.id, newValue: sec });
  return NextResponse.json({ section: sec });
}
