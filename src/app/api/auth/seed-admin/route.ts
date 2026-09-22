import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/auth/seed-admin
//
// DEPRECATED in production — kept for backward compat with the dev seed
// scripts. Always returns whether the database has any users; never creates
// a user via GET.
//
// POST has been REMOVED (was creating hardcoded admin@school.tt/admin123).
// For production bootstrap, use POST /api/setup with SETUP_SECRET env var.
// For local dev, run `bun run scripts/seed.ts`.

export async function GET() {
  const count = await db.user.count();
  return NextResponse.json({
    seeded: count > 0,
    users: count,
    note: "POST /api/auth/seed-admin is disabled. Use POST /api/setup with SETUP_SECRET for production bootstrap, or run scripts/seed.ts for local dev.",
  });
}

export async function POST() {
  return NextResponse.json({
    ok: false,
    error: "ENDPOINT_DISABLED",
    message: "POST /api/auth/seed-admin is disabled. Use POST /api/setup with SETUP_SECRET for production bootstrap, or run scripts/seed.ts for local dev.",
  }, { status: 410 });
}
