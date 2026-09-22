import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/teacher-subjects?teacherId=
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const teacherId = url.searchParams.get("teacherId");
  if (!teacherId) return NextResponse.json({ error: "teacherId required" }, { status: 400 });
  const list = await db.teacherSubject.findMany({
    where: { teacherId },
    include: { subject: true },
  });
  return NextResponse.json({ items: list });
}

// POST { teacherId, subjectId }
export async function POST(req: NextRequest) {
  const { teacherId, subjectId, priority } = await req.json();
  const ts = await db.teacherSubject.create({
    data: { teacherId, subjectId, priority: priority ? Number(priority) : 0 },
  }).catch(() => null);
  if (!ts) return NextResponse.json({ error: "DUPLICATE" }, { status: 409 });
  return NextResponse.json({ ok: true, teacherSubject: ts });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const teacherId = url.searchParams.get("teacherId");
  const subjectId = url.searchParams.get("subjectId");
  if (!teacherId || !subjectId) return NextResponse.json({ error: "missing" }, { status: 400 });
  await db.teacherSubject.deleteMany({ where: { teacherId, subjectId } });
  return NextResponse.json({ ok: true });
}
