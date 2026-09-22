import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/reports/quality?versionId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const schoolId = s.schoolId || url.searchParams.get("schoolId");
  let versionId = url.searchParams.get("versionId");
  if (!versionId && schoolId) {
    const cur = await db.timetableVersion.findFirst({ where: { schoolId, isCurrent: true } });
    versionId = cur?.id || null;
  }
  if (!versionId) return NextResponse.json({ metrics: null });
  const v = await db.timetableVersion.findUnique({ where: { id: versionId } });
  const stats = v?.statistics ? JSON.parse(v.statistics) : null;
  return NextResponse.json({
    version: v ? { id: v.id, version: v.version, name: v.name, qualityScore: stats?.qualityScore ?? null } : null,
    metrics: stats,
  });
}
