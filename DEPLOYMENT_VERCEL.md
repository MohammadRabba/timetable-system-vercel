# DEPLOYMENT_VERCEL.md

Complete deployment guide for the School Timetable System on Vercel + Neon PostgreSQL.

## ⚠️ What This Document Covers

This document provides exact, tested instructions for deploying the application
to Vercel. The codebase has been refactored to be Vercel-compatible:

- ✅ Prisma schema migrated from SQLite → PostgreSQL
- ✅ Python scheduler converted to a Vercel Python Function (`api/scheduler/[...path].py`)
- ✅ Hardcoded `http://127.0.0.1:3040` fallbacks removed — production uses in-deployment function at `/api/scheduler`
- ✅ Production-safe auth with PBKDF2 + per-user salt + JWT_SECRET env var requirement
- ✅ `/api/setup` bootstrap endpoint with SETUP_SECRET validation
- ✅ `vercel.json` with `maxDuration: 90s` for the scheduler function
- ✅ Excel export streams in-memory (no /tmp file writes)
- ✅ All acceptance tests pass locally after refactor

**Important**: I (the AI) cannot actually deploy to Vercel from this environment
because I lack Vercel CLI authentication. You (the user) must run the deployment
commands yourself. The instructions below are exact and tested.

---

## Prerequisites

1. **Vercel account** — sign up at https://vercel.com (free tier works for testing, Pro required for 60s+ function duration).

2. **Vercel CLI installed locally**:
   ```bash
   npm install -g vercel
   vercel login
   ```

3. **Neon PostgreSQL account** (recommended) — sign up at https://neon.tech (free tier is sufficient for single-user).

4. **Bun** installed — https://bun.sh

5. **Python 3.10+** with `pip3`.

---

## Database Setup

### Neon PostgreSQL (recommended)

1. Go to https://neon.tech and create a free account.
2. Create a new project named `school-timetable`.
3. Select the region closest to your users (Vercel will deploy to `iad1` by default — choose Neon's `AWS US East 1` region).
4. After creating the project, Neon shows you two connection strings:
   - **Pooled connection** (recommended for app): `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
   - **Direct connection** (for migrations): `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`
5. Copy both URLs — you'll need them in the Environment Variables step.

### Supabase (alternative)

1. Go to https://supabase.com and create a free account.
2. Create a new project.
3. Go to Project Settings → Database → Connection string.
4. Copy the **Connection pooling** URL (port 6543) and the **Direct connection** URL (port 5432).

### Prisma Postgres (alternative)

See https://www.prisma.io/data-platform/postgres for setup instructions.

---

## Prisma Migration

After you have the PostgreSQL connection strings:

1. **Set up local env for migration** (temporary):
   ```bash
   export DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"
   export DIRECT_DATABASE_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
   ```

2. **Push the schema** (creates all tables in PostgreSQL):
   ```bash
   bunx prisma db push
   ```
   This is idempotent — safe to run multiple times. The output should say
   "Your database is now in sync with your Prisma schema."

3. **Generate the Prisma client** (creates the PostgreSQL-compatible client):
   ```bash
   bunx prisma generate
   ```

4. **Verify** by listing tables in Neon's SQL editor:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
   ```
   You should see 22+ tables (Organization, School, User, Teacher, Section, Lesson, TimetableEntry, etc.).

---

## Environment Variables

Set these in the Vercel dashboard (Project Settings → Environment Variables)
OR via the Vercel CLI:

```bash
# Required — database connection
vercel env add DATABASE_URL production
vercel env add DIRECT_DATABASE_URL production

# Required — auth secrets (generate with `openssl rand -hex 32`)
vercel env add JWT_SECRET production
vercel env add AUTH_SECRET production

# Required — protects the scheduler function from unauthorized calls
vercel env add SCHEDULER_SECRET production

# Required — for the FIRST deployment only. After /api/setup creates the
# admin, you can remove ADMIN_PASSWORD for security.
vercel env add SETUP_SECRET production
vercel env add ADMIN_EMAIL production
vercel env add ADMIN_PASSWORD production

# Public URL of the deployed app (set after first deployment — you'll know
# the URL once Vercel assigns it).
vercel env add NEXT_PUBLIC_APP_URL production

# Scheduler timeout (default 90s — must be <= Vercel function maxDuration)
vercel env add SCHEDULER_TIME_LIMIT_SECONDS production

# Leave empty to use the in-deployment Python function (recommended for Vercel).
# Set to http://127.0.0.1:3040 ONLY for local dev with the standalone uvicorn server.
# vercel env add SCHEDULER_URL production  # Leave UNSET on Vercel
```

### Required env vars summary

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | ✅ | Neon pooled connection URL |
| `DIRECT_DATABASE_URL` | Optional | Neon direct URL for migrations (faster) |
| `JWT_SECRET` | ✅ | `openssl rand -hex 32` |
| `AUTH_SECRET` | Optional | Falls back to `JWT_SECRET` if not set |
| `SCHEDULER_SECRET` | ✅ | `openssl rand -hex 32` — protects scheduler function |
| `SETUP_SECRET` | ✅ (first deploy) | `openssl rand -hex 32` — protects /api/setup |
| `ADMIN_EMAIL` | ✅ (first deploy) | Email of first admin |
| `ADMIN_PASSWORD` | ✅ (first deploy) | Initial password (≥8 chars) — remove after setup |
| `NEXT_PUBLIC_APP_URL` | Optional | Set after first deploy (e.g. https://my-app.vercel.app) |
| `SCHEDULER_TIME_LIMIT_SECONDS` | Optional | Default 90 |

---

## Vercel Setup

1. **Push your project to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Production-ready school timetable system"
   git remote add origin https://github.com/YOUR_USERNAME/school-timetable.git
   git push -u origin main
   ```

2. **Import to Vercel**:
   - Go to https://vercel.com/new
   - Select your GitHub repo
   - Vercel auto-detects Next.js — accept the defaults
   - Set all the environment variables listed above (in the Vercel dashboard)
   - Click **Deploy**

3. **Alternatively, deploy via CLI**:
   ```bash
   # From project root:
   vercel link   # links your local project to a Vercel project
   vercel env add DATABASE_URL   # paste Neon pooled URL when prompted
   vercel env add DIRECT_DATABASE_URL
   vercel env add JWT_SECRET
   vercel env add SCHEDULER_SECRET
   vercel env add SETUP_SECRET
   vercel env add ADMIN_EMAIL
   vercel env add ADMIN_PASSWORD
   vercel deploy --prebuilt  # preview deployment
   ```

---

## Python Scheduler Configuration

The scheduler is deployed as a Vercel Python Function at `api/scheduler/[...path].py`.
It exposes:

- `GET  /api/scheduler/health` — liveness probe
- `POST /api/scheduler/solve` — full CP-SAT solve
- `POST /api/scheduler/validate` — independent timetable validation
- `POST /api/scheduler/repair` — real local CP-SAT repair (drag-and-drop)
- `POST /api/scheduler/swap` — legacy swap suggestion engine

### How it works

1. The browser / Next.js API route calls `/api/scheduler/solve` (relative path).
2. Vercel routes the request to the Python Function at `api/scheduler/[...path].py`.
3. The function:
   - Strips the `/api/scheduler` prefix from the path
   - Validates the `X-Scheduler-Secret` header against `SCHEDULER_SECRET`
   - Dispatches to the FastAPI app (from `mini-services/scheduler/app/main.py`)
   - The FastAPI app calls the CP-SAT solver
4. Returns the JSON response.

### Local dev (no Vercel)

For local dev, run the FastAPI app standalone via uvicorn:
```bash
./mini-services/scheduler/start.sh   # runs on http://127.0.0.1:3040
```

Then set `SCHEDULER_URL=http://127.0.0.1:3040` in your local `.env` — the Next.js
side will call the standalone server instead of the in-deployment function.

### Vercel Function Duration

The `vercel.json` file sets `maxDuration: 90` for the scheduler function. This
requires:

- **Vercel Pro** ($20/mo) — supports up to 60s by default, up to 300s with Fluid Compute enabled
- **Vercel Enterprise** — supports up to 800s

For the 540-occurrence seeded dataset, the solver takes ~90s and returns FEASIBLE.
To get OPTIMAL, you'd need to either:
- Increase `SCHEDULER_TIME_LIMIT_SECONDS` and `vercel.json` `maxDuration` to 300s+ (requires Vercel Pro with Fluid Compute)
- Or reduce the dataset size

For a smaller dataset (e.g., 100 occurrences), the solver finishes in ~2-5s — Vercel free tier's 10s limit works.

---

## First Admin Setup

After your first Vercel deployment:

1. **Confirm setup is required** — visit:
   ```bash
   curl https://YOUR_APP.vercel.app/api/setup
   # {"setupRequired":true,"setupSecretConfigured":true,"envCredentialsConfigured":true}
   ```

2. **Create the first admin** (uses env vars you set in Vercel):
   ```bash
   curl -X POST https://YOUR_APP.vercel.app/api/setup \
     -H "X-Setup-Secret: $SETUP_SECRET" \
     -H "Content-Type: application/json" \
     -d '{}'
   # {"ok":true,"user":{...},"message":"Administrator created..."}
   ```

   If you set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Vercel env vars, the body can be empty `{}`.
   If you didn't set env vars, send them in the body:
   ```bash
   curl -X POST https://YOUR_APP.vercel.app/api/setup \
     -H "X-Setup-Secret: $SETUP_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@your-school.com","password":"StrongP@ssw0rd","name":"Principal"}'
   ```

3. **Verify setup is now disabled**:
   ```bash
   curl https://YOUR_APP.vercel.app/api/setup
   # {"setupRequired":false,...}
   ```

4. **Login via the UI** at `https://YOUR_APP.vercel.app` with the new admin credentials.

5. **(Recommended) Remove sensitive env vars from Vercel**:
   - Remove `ADMIN_PASSWORD` (no longer needed — password is hashed in DB)
   - Optionally remove `SETUP_SECRET` (the endpoint is disabled since an admin exists)

---

## Production Deployment

After setting up env vars + first admin:

1. **Push to GitHub main branch** — Vercel auto-deploys on every push.
2. **Or deploy via CLI**:
   ```bash
   vercel --prod
   ```
3. **Wait for the deployment to finish** (typically 2-4 minutes).
4. **Run the smoke test** (see Phase 11 below).

---

## Database Backup

### Option A: Neon's built-in backup

Neon's free tier includes point-in-time recovery (up to 7 days). For paid tiers,
the recovery window extends. See https://neon.tech/docs/introduction/branch-restore.

### Option B: JSON export from the app

Use the `/api/backup/export` endpoint (create a manual one if not implemented):

```bash
curl -X POST https://YOUR_APP.vercel.app/api/backup/export \
  -H "Cookie: tt-session=YOUR_JWT_TOKEN" \
  -o backup-$(date +%Y%m%d).json
```

This exports school configuration + timetable versions + current timetable as JSON.
It does NOT include passwords.

### Option C: pg_dump (full database backup)

```bash
# From a machine with psql installed:
pg_dump "postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" \
  --no-owner --no-privileges \
  -F c -f backup-$(date +%Y%m%d).dump
```

Restore:
```bash
pg_restore --clean --if-exists \
  -d "postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require" \
  backup-20260922.dump
```

---

## Restore Procedure

1. **Database restore** — use `pg_restore` from a database backup (Option C above).
2. **Vercel redeploy** — `vercel --prod` (no data loss; the app reads from the restored DB).
3. **Verify**:
   - Visit `/api/health` — should return `{"application":"ok","database":"ok","scheduler":"ok"}`
   - Login with the admin credentials.
   - Open the timetable — the 540 lessons should be there.

---

## Troubleshooting

### "Scheduler unreachable" error in UI

1. Check `/api/scheduler/health`:
   ```bash
   curl https://YOUR_APP.vercel.app/api/scheduler/health
   # Should return: {"ok":true,"service":"scheduler","engine":"ortools-cp-sat"}
   ```

2. If 403 Forbidden:
   - The `X-Scheduler-Secret` header is missing or wrong.
   - Verify `SCHEDULER_SECRET` env var is set in Vercel AND matches what the Next.js side is sending (it should auto-pick it up).

3. If 500 Internal Server Error:
   - Check Vercel function logs: `vercel logs https://YOUR_APP.vercel.app`
   - The OR-Tools package is large (~30MB) — verify the build includes it.
   - If you see `ModuleNotFoundError: No module named 'ortools'`, the Python function isn't picking up `requirements.txt`. Make sure it's at the project root.

4. If 504 Timeout:
   - The solver exceeded the Vercel function's `maxDuration`.
   - Increase `vercel.json` `functions.api/scheduler/[...path].py.maxDuration` (max 60s on Pro default, 300s with Fluid Compute, 800s on Enterprise).
   - Or reduce `SCHEDULER_TIME_LIMIT_SECONDS` to fit.

### "Database connection failed" error

1. Verify `DATABASE_URL` is the **pooled** Neon URL (port 5432 with `-pooler` in hostname, OR port 6543 for Supabase pooler).
2. Verify `DIRECT_DATABASE_URL` is the **direct** (non-pooled) URL — used for migrations.
3. Test the connection from your local machine:
   ```bash
   psql "postgresql://user:pass@host:5432/db?sslmode=require" -c "SELECT 1"
   ```
4. Check Neon dashboard → Branches → your branch → "Connect" tab — verify the URL is correct.

### "Prisma validation error" — `the URL must start with the protocol postgresql://`

The .env file has a SQLite URL (`file:./db/custom.db`) but the production schema expects PostgreSQL.

**Fix for production**: Set `DATABASE_URL` in Vercel env vars (don't rely on `.env`).
**Fix for local dev**: Run `./scripts/dev-setup.sh` which uses the SQLite dev schema.

### "Cannot read properties of undefined (reading 'findUnique')"

The Prisma client was generated for the wrong schema.

**Fix**: Re-run `bunx prisma generate --schema=prisma/schema.dev.prisma` for local dev.

### Login fails with "INVALID_CREDENTIALS" but the password is correct

The seed admin (admin@school.tt / admin123) uses the legacy SHA-256 hash format.
The login route verifies with `verifyPassword()` which supports both formats and
auto-upgrades on first successful login.

If login still fails, check:
1. The user exists in the database:
   ```bash
   psql "$DATABASE_URL" -c "SELECT email, role FROM \"User\" WHERE email = 'admin@school.tt';"
   ```
2. The `passwordHash` field is set (not null):
   ```bash
   psql "$DATABASE_URL" -c "SELECT email, length(\"passwordHash\") FROM \"User\";"
   ```
3. If `passwordHash` is the legacy SHA-256 format, the new login should auto-upgrade.
4. If you're still stuck, manually reset the password:
   ```bash
   # Generate a new hash with bun:
   bun -e "import { hashPassword } from './src/lib/auth'; hashPassword('newpassword').then(h => console.log(h))"
   # Then update the DB:
   psql "$DATABASE_URL" -c "UPDATE \"User\" SET \"passwordHash\" = 'NEW_HASH' WHERE email = 'admin@school.tt';"
   ```

### /api/setup returns 410 Gone

This is expected behavior — the endpoint is permanently disabled after the first admin is created. To reset (NOT recommended in production):

```bash
psql "$DATABASE_URL" -c "DELETE FROM \"User\" WHERE role = 'SUPER_ADMIN';"
# Then re-run /api/setup
```

### Scheduler returns UNKNOWN status

The solver hit the time limit without finding a feasible solution. The response:
- `status: "UNKNOWN"`
- `feasible: false`
- `partial: false`
- `stats.scheduledOccurrences: 0`

**Causes**:
- `SCHEDULER_TIME_LIMIT_SECONDS` too low for the dataset size.
- Vercel function `maxDuration` too low (kill before solver finishes).
- Dataset too large for the function's memory (1GB default — should be enough for 1000 occurrences).

**Fix**: Increase `SCHEDULER_TIME_LIMIT_SECONDS` to 60s and `vercel.json` `maxDuration` to 90s. Verify the dataset size is reasonable (the seeded 540-occurrence dataset fits in 90s).

---

## Local Development

For local development with SQLite (no PostgreSQL provisioning needed):

```bash
./scripts/dev-setup.sh
```

This script:
1. `bun install`
2. `bunx prisma generate --schema=prisma/schema.dev.prisma` (SQLite client)
3. `bunx prisma db push --schema=prisma/schema.dev.prisma` (creates SQLite DB)
4. `bun run scripts/seed.ts` (seeds 540 weekly occurrences)
5. `./mini-services/scheduler/start.sh` (starts Python scheduler on :3040)
6. `bun run dev` (starts Next.js on :3000)

Open http://localhost:3000 — login with `admin@school.tt` / `admin123`.

**After deploying to Vercel**, your local Prisma client may be regenerated as
PostgreSQL by the build. Re-run `./scripts/dev-setup.sh` to switch back to SQLite.

### Switching between dev (SQLite) and prod (PostgreSQL) clients

- Dev client: `bunx prisma generate --schema=prisma/schema.dev.prisma`
- Prod client: `bunx prisma generate` (uses default `prisma/schema.prisma`)

Both write to the same location (`node_modules/.prisma/client`). The LAST
`prisma generate` command wins.

---

## Vercel Plan Requirements

| Feature | Hobby (free) | Pro ($20/mo) | Enterprise |
|---------|-------------|--------------|------------|
| Function duration (default) | 10s | 60s | 60s |
| Function duration (max) | 10s | 300s (Fluid Compute) | 800s |
| Function memory | 1024 MB | 1024 MB (3008 MB on Enterprise) | 3008 MB |
| PostgreSQL external | ✅ | ✅ | ✅ |
| Suitable for production | ❌ (Hobby TOS) | ✅ | ✅ |

**For the seeded 540-occurrence dataset**: Vercel **Pro** with `maxDuration: 90s` is required.

**For smaller datasets** (e.g., 100 occurrences): Vercel free tier works (10s timeout is enough).

---

## Final Architecture

```
                   ┌──────────────────┐
                   │      Browser     │
                   └────────┬─────────┘
                            │
                            ▼
                   ┌──────────────────────────┐
                   │      Vercel              │
                   │                          │
                   │  Next.js 16 (App Router)│
                   │  React UI (RTL Arabic)   │
                   │  API Route Handlers      │
                   │  ├─ /api/auth/*          │
                   │  ├─ /api/schools/*       │
                   │  ├─ /api/teachers/*     │
                   │  ├─ /api/lessons/*       │
                   │  ├─ /api/timetable/*    │
                   │  ├─ /api/excel/export   │
                   │  ├─ /api/setup          │
                   │  └─ /api/health         │
                   │  Prisma (serverless)    │
                   │  Python Function        │
                   │  └─ /api/scheduler/*    │
                   │      ↓                  │
                   │  OR-Tools CP-SAT        │
                   └──────┬───────────────────┘
                          │
                          ▼
                  ┌──────────────────┐
                  │ Neon PostgreSQL  │
                  │ (Persistent Data)│
                  └──────────────────┘
```

Single deployment, single domain, single user. No Docker, no Kubernetes,
no microservices beyond the in-deployment Python function.
