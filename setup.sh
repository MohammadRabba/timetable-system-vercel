#!/usr/bin/env bash
# setup.sh — one-shot setup for the School Timetable System.
#
# Installs:
#   1. JS dependencies (Next.js, Prisma, dnd-kit, etc.) via `bun install`
#   2. Python dependencies (OR-Tools, FastAPI, uvicorn, pydantic) via `pip3 install`
#   3. Prisma client + SQLite DB schema via `bunx prisma db push`
#   4. Demo dataset (1 school, 30 teachers, 540 weekly lessons) via `bun run scripts/seed.ts`
#
# Then starts both services:
#   - Python OR-Tools scheduler microservice on port 3040 (background, via setsid -f)
#   - Next.js dev server on port 3000 (foreground)
#
# Open http://localhost:3000 and log in with admin@school.tt / admin123.

set -e
cd "$(dirname "$0")"

echo "============================================================"
echo " School Timetable System — Setup"
echo "============================================================"
echo ""

# Check prerequisites
command -v bun >/dev/null 2>&1 || {
  echo "✗ Bun is not installed. Install from https://bun.sh"
  echo "  curl -fsSL https://bun.sh/install | bash"
  exit 1
}
command -v python3 >/dev/null 2>&1 || { echo "✗ python3 is not installed"; exit 1; }
command -v pip3 >/dev/null 2>&1 || { echo "✗ pip3 is not installed"; exit 1; }

echo "✓ Prerequisites: bun $(bun --version), python3 $(python3 --version 2>&1 | awk '{print $2}')"
echo ""

# Step 1: Install JS deps
echo "[1/5] Installing JS dependencies (bun install)..."
bun install
echo "✓ JS dependencies installed"
echo ""

# Step 2: Install Python deps
echo "[2/5] Installing Python dependencies (ortools, fastapi, uvicorn, pydantic)..."
pip3 install -r mini-services/scheduler/requirements.txt
echo "✓ Python dependencies installed"
echo ""

# Step 3: Push Prisma schema + generate client
echo "[3/5] Pushing Prisma schema to SQLite..."
bunx prisma db push --accept-data-loss
bunx prisma generate
echo "✓ Prisma schema + client ready"
echo ""

# Step 4: Seed demo dataset
echo "[4/5] Seeding demo dataset (540 weekly occurrences, 60 duties)..."
bun run scripts/seed.ts
echo "✓ Demo dataset seeded"
echo ""

# Step 5: Start scheduler service
echo "[5/5] Starting scheduler microservice on port 3040..."
cd mini-services/scheduler
./start.sh
cd ../..
echo ""

echo "============================================================"
echo " Setup complete!"
echo "============================================================"
echo ""
echo "Scheduler service: http://127.0.0.1:3040/health"
echo "Next.js app:       http://localhost:3000 (will start now)"
echo ""
echo "Demo logins:"
echo "  Super Admin:   admin@school.tt / admin123"
echo "  School Admin:   schooladmin@najah.tt / demo123"
echo "  Scheduler:      scheduler@najah.tt / demo123"
echo "  Viewer:         viewer@najah.tt / demo123"
echo ""
echo "Press Ctrl+C to stop the Next.js dev server."
echo "To stop the scheduler: pkill -f 'uvicorn.*3040'"
echo ""

# Start Next.js in foreground
bun run dev
