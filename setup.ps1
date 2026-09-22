# setup.ps1 - School Timetable System setup for Windows PowerShell

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " School Timetable System - Windows Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# Check prerequisites
# ------------------------------------------------------------

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Bun is not installed." -ForegroundColor Red
    Write-Host "Install Bun from https://bun.sh"
    exit 1
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Python is not installed." -ForegroundColor Red
    exit 1
}

Write-Host "Bun:    $(bun --version)" -ForegroundColor Green
Write-Host "Python: $(python --version)" -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Step 1 - JavaScript dependencies
# ------------------------------------------------------------

Write-Host "[1/5] Installing JavaScript dependencies..." -ForegroundColor Yellow

bun install

Write-Host "JavaScript dependencies installed." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Step 2 - Python dependencies
# ------------------------------------------------------------

Write-Host "[2/5] Installing Python dependencies..." -ForegroundColor Yellow

python -m pip install -r "mini-services\scheduler\requirements.txt"

Write-Host "Python dependencies installed." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Step 3 - Prisma
# ------------------------------------------------------------

Write-Host "[3/5] Generating Prisma client..." -ForegroundColor Yellow

bunx prisma generate

Write-Host "Prisma client generated." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Step 4 - Seed database
# ------------------------------------------------------------

Write-Host "[4/5] Seeding database..." -ForegroundColor Yellow

bun run scripts/seed.ts

Write-Host "Database seed completed." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Step 5 - Start scheduler
# ------------------------------------------------------------

Write-Host "[5/5] Starting scheduler service..." -ForegroundColor Yellow

$schedulerPath = Join-Path $PSScriptRoot "mini-services\scheduler"

Start-Process powershell `
    -ArgumentList "-NoExit", "-Command", "Set-Location '$schedulerPath'; .\start.ps1" `
    -WorkingDirectory $schedulerPath

Write-Host "Scheduler started." -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------
# Start Next.js
# ------------------------------------------------------------

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Setup complete!" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Scheduler: http://127.0.0.1:3040/health"
Write-Host "Next.js:   http://localhost:3000"
Write-Host ""
Write-Host "Demo logins:"
Write-Host "  Super Admin: admin@school.tt / admin123"
Write-Host "  School Admin: schooladmin@najah.tt / demo123"
Write-Host "  Scheduler: scheduler@najah.tt / demo123"
Write-Host "  Viewer: viewer@najah.tt / demo123"
Write-Host ""

bun run dev
