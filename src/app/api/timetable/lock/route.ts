import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// POST /api/timetable/lock { entryId, locked }
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const entryId = body.entryId;
  const locked = Boolean(body.locked);
  const entry = await db.timetableEntry.update({
    where: { id: entryId },
    data: { locked },
  });
  await db.timetableChange.create({
    data: {
      versionId: entry.versionId,
      action: locked ? "LOCK" : "UNLOCK",
      payload: JSON.stringify({ entryId }),
    },
  });
  await audit({
    userId: s.id,
    schoolId: entry.schoolId,
    action: locked ? "LOCK_ENTRY" : "UNLOCK_ENTRY",
    entity: "TimetableEntry",
    entityId: entryId,
    newValue: { locked },
  });
  return NextResponse.json({ ok: true, entry });
}
