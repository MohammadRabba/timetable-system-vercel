#!/usr/bin/env bash
# Local development setup — uses SQLite (no DB provisioning required).
#
# Production uses PostgreSQL (Neon/Supabase). For local development,
# SQLite is faster (no DB to provision) and the schema is identical
# (the domain model is provider-agnostic).
#
# Usage:
#   ./scripts/dev-setup.sh
#
# This will:
#   1. bun install
#   2. pip install -r mini-services/scheduler/requirements.txt (optional)
#   3. bunx prisma generate --schema=prisma/schema.dev.prisma
#   4. bunx prisma db push --schema=prisma/schema.dev.prisma --accept-data-loss
#   5. bun run scripts/seed.ts (creates 540 weekly occurrences)
#   6. mini-services/scheduler/start.sh (starts the Python scheduler on :3040)
#   7. bun run dev (starts Next.js on :3000)
#
# For PRODUCTION deployment on Vercel, see DEPLOYMENT_VERCEL.md.

set -e
cd "$(dirname "$0")/.."

echo "============================================================"
echo " Local Development Setup (SQLite)"
echo "============================================================"

# Step 1: Install JS deps
if [ ! -d node_modules ]; then
  echo "[1/6] Installing JS dependencies..."
  bun install
fi

# Step 2: Generate Prisma client (dev schema = SQLite)
echo "[2/6] Generating Prisma client (SQLite dev schema)..."
bunx prisma generate --schema=prisma/schema.dev.prisma

# Step 3: Push SQLite schema
echo "[3/6] Pushing SQLite schema..."
bunx prisma db push --schema=prisma/schema.dev.prisma --accept-data-loss

# Step 4: Seed (only if empty)
echo "[4/6] Seeding demo dataset..."
bun run scripts/seed.ts || echo "(seed may have already run)"

# Step 5: Start scheduler
echo "[5/6] Starting Python scheduler on port 3040..."
bash mini-services/scheduler/start.sh || true

# Step 6: Start Next.js dev server
echo "[6/6] Starting Next.js on port 3000..."
echo ""
echo "✓ Setup complete. Open http://localhost:3000"
echo "✓ Login: admin@school.tt / admin123"
echo ""
exec bun run dev
