import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/scheduling/runs?schoolId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const runs = await db.schedulingRun.findMany({
    where: { schoolId: schoolId || undefined },
    include: { version: true },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ runs });
}
