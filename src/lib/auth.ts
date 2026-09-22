import { db } from "@/lib/db";
import { cookies } from "next/headers";
import jwt from "jsonwebtoken";

// JWT secret — required in production. The dev fallback is for local
// development ONLY; production deployments MUST set JWT_SECRET (long random
// string generated via `openssl rand -hex 32`).
const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || "dev-secret-change-in-production-please";

// Fail-fast: if running in production (NODE_ENV=production) without a real
// JWT secret, refuse to start. This prevents accidental deploys with the
// dev fallback secret.
if (process.env.NODE_ENV === "production" &&
    (!process.env.JWT_SECRET && !process.env.AUTH_SECRET ||
     JWT_SECRET === "dev-secret-change-in-production-please")) {
  throw new Error(
    "FATAL: JWT_SECRET (or AUTH_SECRET) must be set to a long random string in production. " +
    "Generate with: openssl rand -hex 32"
  );
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "SCHEDULER" | "TEACHER" | "VIEWER";
  schoolId: string | null;
  teacherId: string | null;
};

/**
 * Hash a password using PBKDF2 (Web Crypto API — works on Node + Edge + browser).
 * Output format: `pbkdf2$iterations$saltHex$hashHex`
 *
 * This is stateless and works in any JavaScript runtime. The per-user salt
 * (16 random bytes) means two users with the same password get different
 * hashes — a significant improvement over the old static-salt SHA-256.
 *
 * For verification, see verifyPassword().
 */
export async function hashPassword(pw: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100_000;
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"],
  );
  const buf = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key, 256,
  );
  const hashHex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Supports two formats:
 *   - New: `pbkdf2$iterations$saltHex$hashHex` (per-user salt, PBKDF2)
 *   - Legacy: 64-char hex (static-salt SHA-256, kept for backward compat with
 *             dev seed.ts)
 */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  if (stored.startsWith("pbkdf2$")) {
    const [, itersStr, saltHex, hashHex] = stored.split("$");
    const iterations = parseInt(itersStr, 10);
    const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"],
    );
    const buf = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key, 256,
    );
    const computed = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    // Constant-time comparison
    if (computed.length !== hashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i);
    }
    return diff === 0;
  }
  // Legacy SHA-256 with static salt (dev seed)
  const enc = new TextEncoder();
  const data = enc.encode(`salt::${pw}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  const computed = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return computed === stored;
}

export async function signSession(user: SessionUser): Promise<string> {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionUser;
    return decoded;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("tt-session")?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function requireRole(roles: SessionUser["role"][]): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  if (!roles.includes(s.role)) throw new Error("FORBIDDEN");
  return s;
}

export async function audit(opts: {
  userId?: string;
  schoolId?: string;
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
}) {
  try {
    await db.auditLog.create({
      data: {
        userId: opts.userId || null,
        schoolId: opts.schoolId || null,
        action: opts.action,
        entity: opts.entity,
        entityId: opts.entityId || null,
        oldValue: opts.oldValue ? JSON.stringify(opts.oldValue) : null,
        newValue: opts.newValue ? JSON.stringify(opts.newValue) : null,
        ip: opts.ip || null,
      },
    });
  } catch (e) {
    // Audit log failures must NOT break the user's request. Log to stderr.
    console.error("[audit] log failed:", e);
  }
}
