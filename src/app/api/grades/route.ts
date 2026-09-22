import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

async function schoolIdFromQuery(req: NextRequest): Promise<string | null> {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return null;
  if (s.role === "SUPER_ADMIN") {
    return url.searchParams.get("schoolId") || s.schoolId || null;
  }
  return s.schoolId || url.searchParams.get("schoolId");
}

// GET /api/grades?schoolId=
export async function GET(req: NextRequest) {
  const schoolId = await schoolIdFromQuery(req);
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });
  const grades = await db.grade.findMany({
    where: { schoolId },
    include: { _count: { select: { sections: true, branches: true } } },
    orderBy: [{ stage: "asc" }, { order: "asc" }],
  });
  return NextResponse.json({ grades });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });

  const g = await db.grade.create({
    data: {
      schoolId,
      stage: body.stage || "Secondary",
      name: body.name,
      order: body.order ? Number(body.order) : 0,
    },
  });
  await audit({ userId: s.id, schoolId, action: "CREATE_GRADE", entity: "Grade", entityId: g.id, newValue: g });
  return NextResponse.json({ grade: g });
}
