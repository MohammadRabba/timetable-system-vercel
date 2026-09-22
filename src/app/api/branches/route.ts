import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// GET /api/branches?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const gradeId = url.searchParams.get("gradeId");
  const branches = await db.branch.findMany({
    where: { schoolId: schoolId || undefined, gradeId: gradeId || undefined },
    include: { grade: true, _count: { select: { sections: true } } },
  });
  return NextResponse.json({ branches });
}

export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await req.json();
  const b = await db.branch.create({
    data: {
      schoolId: body.schoolId || s.schoolId!,
      gradeId: body.gradeId,
      name: body.name,
    },
  });
  await audit({ userId: s.id, schoolId: b.schoolId, action: "CREATE_BRANCH", entity: "Branch", entityId: b.id, newValue: b });
  return NextResponse.json({ branch: b });
}
