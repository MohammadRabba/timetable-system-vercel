// Prisma client — production-safe for Vercel serverless.
//
// - Reuses the client across hot-reloads in dev (prevents connection exhaustion)
// - In production (Vercel), each function invocation may create a new client,
//   but Prisma's connection pool handles this efficiently
// - Query logging is dev-only (production logs would be too noisy)
// - Supports both PostgreSQL (production) and SQLite (local dev) — the
//   schema.prisma file is the source of truth; lib/db.ts just instantiates
//   the client.

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Only log queries in development (avoid massive log volume in production)
const logConfig = process.env.NODE_ENV === 'production'
  ? ['error', 'warn']
  : ['query', 'error', 'warn']

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logConfig as any,
  })

// Cache the client globally in dev to survive Next.js hot-reloads.
// In production (Vercel), the function instance is short-lived so
// the global cache is per-instance — that's fine, Prisma's pool handles it.
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
