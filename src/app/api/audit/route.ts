import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/audit?schoolId=&limit=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  const limit = Number(url.searchParams.get("limit") || 100);
  const logs = await db.auditLog.findMany({
    where: { schoolId: schoolId || undefined },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ logs });
}
