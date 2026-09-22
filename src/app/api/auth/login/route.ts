import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword, signSession, audit } from "@/lib/auth";

// POST /api/auth/login
//
// Verifies password using verifyPassword() which supports both:
//   - PBKDF2 with per-user salt (production format from /api/setup)
//   - Legacy SHA-256 with static salt (dev seed format)
//
// On successful legacy login, the user's passwordHash is silently upgraded
// to the new PBKDF2 format (transparent migration).
export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password)
    return NextResponse.json({ error: "EMAIL_PASSWORD_REQUIRED" }, { status: 400 });

  const user = await db.user.findUnique({
    where: { email: String(email).toLowerCase() },
    include: { school: true, teacher: true, organization: true },
  });
  if (!user)
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok)
    return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });

  // Transparent upgrade: if the stored hash is the legacy SHA-256 format,
  // re-hash with PBKDF2 and persist. Failures are logged but do not block login.
  if (!user.passwordHash.startsWith("pbkdf2$")) {
    try {
      const newHash = await hashPassword(password);
      await db.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    } catch (e) {
      console.error("[auth] failed to upgrade legacy hash:", e);
    }
  }

  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
    teacherId: user.teacherId,
  };
  const token = await signSession(payload);
  const res = NextResponse.json({ ok: true, user: payload });
  res.cookies.set("tt-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  await audit({
    userId: user.id,
    schoolId: user.schoolId || undefined,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
  });
  return res;
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
