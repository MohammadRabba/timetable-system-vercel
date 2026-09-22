import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, signSession, audit } from "@/lib/auth";

// POST /api/setup
//
// Bootstrap endpoint for the FIRST deployment — creates the initial
// SUPER_ADMIN. After the first admin exists, this endpoint returns 410 Gone
// (permanently disabled) so it cannot be re-invoked to create a second admin
// or to reset the password.
//
// Authentication:
//   The caller must include the bootstrap secret in the `X-Setup-Secret`
//   header. The secret must match the SETUP_SECRET env var.
//
// Credentials:
//   Two ways to specify the admin credentials:
//     (A) Env vars (recommended, never appears in request body):
//         ADMIN_EMAIL, ADMIN_PASSWORD
//     (B) Request body (useful for one-off setup; requires the secret):
//         { "email": "...", "password": "...", "name": "..." }
//
//   If both are provided, env vars take precedence.
//
// In production:
//   - Set SETUP_SECRET to a long random string.
//   - Set ADMIN_EMAIL to the desired admin email.
//   - Set ADMIN_PASSWORD to a strong initial password (user should change it
//     after first login).
//   - After /api/setup succeeds, the user can unset ADMIN_PASSWORD to remove
//     it from the env (the password is now persisted hashed in the DB).
//   - SETUP_SECRET can also be removed (the endpoint is disabled once an
//     admin exists).
//
// In development:
//   - This endpoint is NOT the local dev path. Local dev uses
//     `bun run scripts/seed.ts` which creates a demo admin at
//     admin@school.tt/admin123.
//
// Idempotency:
//   - If a SUPER_ADMIN already exists, this endpoint returns 410 Gone with
//     a clear message. It does NOT create a second admin.
//   - Safe to call multiple times during initial setup attempts.

const SETUP_SECRET = process.env.SETUP_SECRET || "";
const ENV_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export async function POST(req: NextRequest) {
  // 1. Refuse if any SUPER_ADMIN already exists
  const adminCount = await db.user.count({ where: { role: "SUPER_ADMIN" } });
  if (adminCount > 0) {
    return NextResponse.json({
      ok: false,
      error: "SETUP_DISABLED",
      message: "An administrator already exists. The /api/setup endpoint is permanently disabled.",
    }, { status: 410 });
  }

  // 2. Validate the bootstrap secret
  const providedSecret = req.headers.get("x-setup-secret") || "";
  if (!SETUP_SECRET) {
    return NextResponse.json({
      ok: false,
      error: "SETUP_SECRET_NOT_CONFIGURED",
      message: "Server is missing SETUP_SECRET env var — bootstrap is disabled.",
    }, { status: 503 });
  }
  if (providedSecret !== SETUP_SECRET) {
    return NextResponse.json({
      ok: false,
      error: "INVALID_SETUP_SECRET",
      message: "X-Setup-Secret header does not match SETUP_SECRET.",
    }, { status: 403 });
  }

  // 3. Resolve credentials (env vars take precedence)
  let email: string;
  let password: string;
  let name: string;

  const body: any = await req.json().catch(() => ({}));
  email = (ENV_ADMIN_EMAIL || body.email || "").toString().toLowerCase().trim();
  password = ENV_ADMIN_PASSWORD || body.password || "";
  name = body.name || "Administrator";

  // 4. Validate credentials
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({
      ok: false, error: "INVALID_EMAIL",
      message: "A valid email is required (set ADMIN_EMAIL env var or send email in body).",
    }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({
      ok: false, error: "WEAK_PASSWORD",
      message: "Password must be at least 8 characters (set ADMIN_PASSWORD env var or send password in body).",
    }, { status: 400 });
  }
  // Check email uniqueness
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({
      ok: false, error: "EMAIL_TAKEN",
      message: `A user with email ${email} already exists (but is not a SUPER_ADMIN — fix manually).`,
    }, { status: 409 });
  }

  // 5. Create organization + super admin
  const pwHash = await hashPassword(password);
  let org = await db.organization.findFirst({ where: { code: "MOE" } });
  if (!org) {
    org = await db.organization.create({ data: { name: "Ministry of Education", code: "MOE" } });
  }
  const user = await db.user.create({
    data: {
      email, name,
      passwordHash: pwHash,
      role: "SUPER_ADMIN",
      organizationId: org.id,
    },
  });

  await audit({
    userId: user.id,
    action: "SETUP_CREATE_ADMIN",
    entity: "User",
    entityId: user.id,
    newValue: { email, name, role: "SUPER_ADMIN" },  // NEVER log the password
  });

  // 6. Sign a session for immediate login (convenience — but the password
  //    should still be changed on first login if env var was used).
  const payload = {
    id: user.id, email: user.email, name: user.name, role: user.role as const,
    schoolId: user.schoolId, teacherId: user.teacherId,
  };
  const token = await signSession(payload);
  const res = NextResponse.json({
    ok: true,
    user: payload,
    message: "Administrator created. Keep this token safe. Change the password after first login if you used the ADMIN_PASSWORD env var.",
  });
  res.cookies.set("tt-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}

// GET /api/setup — returns whether setup is still possible (no admin yet).
// Does NOT reveal the secret or any existing user details.
export async function GET() {
  const adminCount = await db.user.count({ where: { role: "SUPER_ADMIN" } });
  return NextResponse.json({
    setupRequired: adminCount === 0,
    setupSecretConfigured: !!SETUP_SECRET,
    envCredentialsConfigured: !!(ENV_ADMIN_EMAIL && ENV_ADMIN_PASSWORD),
  });
}
