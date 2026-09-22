import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/health
//
// Production health endpoint — returns the status of:
//   - application: ok if this route is reachable
//   - database:    ok if Prisma can execute a simple SELECT
//   - scheduler:   ok if SCHEDULER_URL is set (local dev) OR if the
//                  in-deployment Python function is configured (production)
//
// Does NOT expose any secrets, env var values, or internal paths.

export async function GET() {
  const result: {
    application: "ok" | "fail";
    database: "ok" | "fail";
    scheduler: "ok" | "fail" | "skipped";
    configuration: {
      schedulerProvider: string;
      schedulerTimeLimit: number;
      schedulerUrlConfigured: boolean;
      schedulerSecretConfigured: boolean;
      jwtSecretConfigured: boolean;
      setupCompleted: boolean | null;
    };
    timestamp: string;
  } = {
    application: "ok",
    database: "fail",
    scheduler: "skipped",
    configuration: {
      schedulerProvider: process.env.SCHEDULER_PROVIDER || "ortools",
      schedulerTimeLimit: Number(process.env.SCHEDULER_TIME_LIMIT_SECONDS || 90),
      schedulerUrlConfigured: !!process.env.SCHEDULER_URL,
      schedulerSecretConfigured: !!process.env.SCHEDULER_SECRET,
      jwtSecretConfigured: !!(process.env.JWT_SECRET || process.env.AUTH_SECRET),
      setupCompleted: null,
    },
    timestamp: new Date().toISOString(),
  };

  // Database check — run a trivial query. Wrap in try/catch so a DB
  // failure doesn't crash the health endpoint.
  try {
    await db.$queryRaw`SELECT 1`;
    result.database = "ok";
  } catch (e) {
    result.database = "fail";
  }

  // Setup status — is there a SUPER_ADMIN yet?
  try {
    const count = await db.user.count({ where: { role: "SUPER_ADMIN" } });
    result.configuration.setupCompleted = count > 0;
  } catch {
    // If DB is unreachable, leave setupCompleted as null
  }

  // Scheduler check — only do an HTTP call if we have a SCHEDULER_URL
  // (local dev). For production (in-deployment function), we trust it's
  // reachable — calling it here would be recursive (the function would
  // call itself).
  if (process.env.SCHEDULER_URL) {
    try {
      const r = await fetch(`${process.env.SCHEDULER_URL}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      result.scheduler = r.ok ? "ok" : "fail";
    } catch {
      result.scheduler = "fail";
    }
  } else {
    // Production (in-deployment function) — mark "skipped" to avoid recursion.
    // The dedicated /api/scheduler/health endpoint is the way to verify it.
    result.scheduler = "skipped";
  }

  // HTTP 200 if app + DB are ok; HTTP 503 otherwise
  const ok = result.application === "ok" && result.database === "ok";
  return NextResponse.json(result, { status: ok ? 200 : 503 });
}
