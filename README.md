# نظام الجدول المدرسي | School Timetable Management & Scheduling System

A production-grade school timetable management and automatic scheduling platform with a real **Google OR-Tools CP-SAT** constraint-optimization engine, Arabic-first RTL UI, full CRUD, version control, drag-and-drop editing with **real local CP-SAT repair**, Excel export, reports, and audit logs.

## System Architecture

```
Next.js 16 (App Router, TypeScript)  ←→  Python FastAPI + OR-Tools CP-SAT microservice
   ├── shadcn/ui + Tailwind CSS 4 (RTL Arabic-first)         (port 3040)
   ├── TanStack Query (server state)
   ├── Zustand (client state, undo/redo, navigation)
   ├── dnd-kit (drag-and-drop with conflict detection + repair)
   └── ExcelJS (Excel export)
                    ↓
                Prisma ORM → SQLite (file-based)
```

## Features

- **Real constraint-optimization solver** (Google OR-Tools CP-SAT, not random)
- **540/540 feasible timetable** with **0 hard violations** on the seeded dataset
- **Real local CP-SAT repair engine** — drag a lesson, system proposes a minimal-set repair showing what will move BEFORE you commit
- **Strict feasibility criteria**: `feasible = (scheduled == required) AND (hardViolations == 0)`
- **Independent validator** — re-checks the timetable from scratch, never trusts the solver
- **Pre-solver conflict analyzer** — detects capacity problems before CP-SAT starts
- **Dynamic `periodsPerDay`** — UI renders P1..Pn dynamically; "seventh period" is a separate business concept (Period.type == "SEVENTH"), decoupled from the last period of the day
- **True teacher gap calculation** — counts only internal gaps between first and last occupied periods (75% gap reduction on seeded dataset)
- **Arabic RTL primary + English LTR toggle** (Zustand-persisted)
- **Multi-tenant schools** with role-based access (SuperAdmin/SchoolAdmin/Scheduler/Teacher/Viewer)
- **Real authentication** (JWT cookies, hashed passwords)
- **Real database** (Prisma + SQLite, 22 normalized models)
- **Real CRUD** for every entity (schools, grades, branches, sections, subjects, teachers, rooms, lessons, duties, constraints)
- **Real version control** — each generation creates a snapshot; restore/compare/duplicate supported
- **Real undo/redo** via TimetableChange event log
- **Real drag-and-drop** with hard-constraint validation (rejects conflicts; offers automatic repair)
- **Real locking** (per-entry; locked lessons survive re-generation and repair)
- **Real Excel export** (one workbook with 8 sheets — overview, per-teacher, per-class, per-room, workload, duties, free periods, conflicts — RTL formatted)
- **Real reports** (workload, free periods, duties, conflicts, room utilization, seventh balance, quality metrics)
- **Real audit log** (every mutation recorded with user, action, entity, old/new value, timestamp)
- **Real dashboard stats** (computed from database, not hardcoded)
- **Keyboard shortcuts** (Ctrl+Z/Y, F for search, Esc to cancel drag)
- **Mobile-responsive** (sidebar collapses, touch targets >= 44px)

## Quick Start

### Prerequisites

- **Node.js 18+** and **Bun** (recommended) — install from https://bun.sh
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **Python 3.10+** with pip
- (Linux) `apt-get install -y libnss3 libgtk-3-0t64 fonts-noto-cjk` for headless browser screenshots (optional)

### Setup

```bash
# 1. Extract the ZIP
unzip timetable-system.zip
cd timetable-system

# 2. Copy the env template and adjust if needed
cp .env.example .env
# Default: DATABASE_URL=file:./db/custom.db
#          SCHEDULER_URL=http://127.0.0.1:3040
#          SCHEDULER_PROVIDER=ortools

# 3. Install JS dependencies (Next.js, Prisma, dnd-kit, etc.)
bun install

# 4. Install Python dependencies for the scheduler microservice
pip3 install -r mini-services/scheduler/requirements.txt
# (ortools==9.15.6755, fastapi==0.128.0, uvicorn==0.44.0, pydantic==2.12.5)

# 5. Push the Prisma schema to SQLite (creates the DB file)
bunx prisma db push --accept-data-loss

# 6. Generate the Prisma client (TypeScript types)
bunx prisma generate

# 7. Seed the demo dataset (1 school, 30 teachers, 15 sections, 12 subjects,
#    23 rooms, 180 lessons = 540 weekly occurrences, 60 duties)
bun run scripts/seed.ts
```

### Run

You need **two** services running in separate terminals:

**Terminal 1 — Python OR-Tools scheduler microservice:**

```bash
cd mini-services/scheduler
./start.sh
# Output: ✓ Scheduler started on port 3040
# Verify: curl http://127.0.0.1:3040/health
# {"ok":true,"service":"scheduler","engine":"ortools-cp-sat"}
```

**Terminal 2 — Next.js app:**

```bash
bun run dev
# Output: ▲ Next.js 16.1.3 (Turbopack)
#         - Local: http://localhost:3000
```

Open **http://localhost:3000** in your browser and log in with one of the demo accounts below.

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | `admin@school.tt` | `admin123` |
| School Admin | `schooladmin@najah.tt` | `demo123` |
| Scheduler | `scheduler@najah.tt` | `demo123` |
| Viewer | `viewer@najah.tt` | `demo123` |

## Demo Dataset (auto-seeded)

- School: مدرسة النجاح الثانوية (Al-Najah Secondary)
- 30 teachers (Arabic names)
- 15 sections across grades 10, 11, 12 (Scientific & Literary branches)
- 12 subjects (Arabic, English, Math, Physics, Chemistry, Biology, History, Geography, Islamic, CS, PE, Art)
- 23 rooms (15 classrooms, 3 labs, 2 computer labs, gym, art room, auditorium)
- 180 lessons × weekly occurrences = **540 weekly periods**
- 60 duties (supervision/duty/reserve)
- Rotating day-off per teacher
- School: 5 working days × **8 periods/day** (gives 40 slots/section; 36 lessons/section fit comfortably)

## Workflow

1. **Login** → School auto-selected.
2. **Dashboard** shows real stats (540 lessons, 30 teachers, 23 rooms, etc.).
3. **Configure** (if needed): Academic Structure → Subjects → Teachers → Rooms → Lessons → Duties → Constraints.
4. **Generate Timetable** (Schedule pane):
   - Pre-validate → solve via OR-Tools CP-SAT → save snapshot.
   - On the seeded dataset: **OPTIMAL** in ~10s without gap penalty, **FEASIBLE** in ~90s with gap penalty (75% gap reduction).
5. **View Timetable** — 5 views: School / Teacher / Class / Room / Subject.
   - Drag-and-drop a lesson to another slot:
     - If the target is free → move applies immediately.
     - If the target is occupied (conflict) → toast appears with **"Auto-repair"** button.
     - Click **Auto-repair** → engine runs CP-SAT on the local neighborhood (radius 2) and proposes a minimal-change repair.
     - A modal shows what will move (lesson, from-slot, to-slot, reason) BEFORE committing.
     - Click **Apply** to commit, or **Cancel** to discard.
6. **Conflict Center** — see critical issues, jump to location.
7. **Reports** — workload, free periods, duties, room utilization, seventh balance, quality metrics.
8. **Excel Export** — multi-sheet .xlsx with Arabic RTL formatting.
9. **Audit Log** — every change tracked.

## Scheduling Engine Internals

### Hard Constraints (H1-H11)

| Code | Constraint |
|------|-----------|
| H1 | Teacher conflict — no two occurrences share `(teacher, day, period)` |
| H2 | Class conflict — no two occurrences share `(section, day, period)` |
| H3 | Room conflict — no two occurrences share `(room, day, period)` |
| H4 | Teacher availability — candidates exclude forbidden/unavailable slots |
| H5 | Teacher day off — candidates exclude day-off slots |
| H6 | Duty conflict — candidates exclude duty slots |
| H7 | Fixed lessons — fixed occurrences get a single candidate slot |
| H8 | Room compatibility — only compatible rooms enumerated |
| H9 | Room capacity — only sufficient-capacity rooms enumerated |
| H10 | Weekly occurrence count — each occurrence placed exactly once |
| H11 | Teacher qualification — only qualified teachers appear in lesson.teacherId |

### Soft Constraints (S1-S7, weighted, minimized)

| Code | Penalty |
|------|---------|
| S1 | Teacher gaps (true calculation) — internal gaps between first and last occupied period |
| S2 | Subject clustering — multiple same-subject occurrences in same (section, day) |
| S3 | Unbalanced daily load — per-teacher daily count spread |
| S4 | Seventh-period imbalance — `sum|seventh_count - target|` (seventh period = the Period.type=="SEVENTH" row, NOT the last period) |
| S5 | Unwanted periods — non-preferred period usage |
| S6 | Teacher preferences — reward preferred periods (negative penalty) |
| S7 | Consecutive lessons — reward configured consecutive runs |

### Local Repair Engine (Phase 5+6)

`POST /scheduler/repair` (or `/api/timetable/repair` from the Next.js side):

1. Load current timetable entries.
2. Pre-apply the user's drag (movedOccurrenceId → newDay, newPeriod, newRoomId).
3. Detect direct conflicts at the target slot.
4. BFS neighborhood (radius-N, default 2) over (teacher/section/room)-conflict edges.
5. **Freeze** all lessons OUTSIDE the neighborhood at their current slots.
6. Allow lessons IN the neighborhood to move.
7. Run CP-SAT only on the neighborhood (much smaller model → fast, typically <500ms).
8. Preserve all hard constraints (H1-H11).
9. **Objective (Phase 6)**: minimize `10000 × num_moved_lessons + soft_penalty` — STRONGLY prefers moving 1 lesson over 10 lessons.
10. Return the full repaired timetable + a list of proposed changes (lessonId, fromDay, fromPeriod, fromRoomId, toDay, toPeriod, toRoomId, reason).

The UI shows the proposed changes in a modal BEFORE committing — the user must click **Apply** (which calls `/api/timetable/move` for each change) or **Cancel**.

## Acceptance Suite

The system includes a complete automated acceptance suite:

```bash
# A. OR-Tools deterministic unit tests (10 scenarios)
cd mini-services/scheduler && python3 app/tests/test_solver.py

# B. Phase 1 — verify real timetable in UI (login, generate, verify 5 views + 10 DB checks)
python3 /path/to/scripts/phase1_verify_ui.py

# C. Phase 2 — verify periodsPerDay is dynamic + "seventh period" decoupled
python3 /path/to/scripts/phase2_verify_periods.py

# D. Phase 3 — solver pipeline profiling (10 stages)
python3 /path/to/scripts/phase3_profile.py

# E. Phase 9 — seventh-period balancing independent verification
python3 /path/to/scripts/phase9_seventh.py

# F. Phase 10 — local repair acceptance tests (8 scenarios)
python3 /path/to/scripts/phase10_repair_tests.py

# G. Original acceptance suite (540/540 + stress + integration)
python3 /path/to/scripts/acceptance_suite.py
```

All acceptance tests pass on the seeded dataset.

## Project Structure

```
timetable-system/
├── README.md                   (this file)
├── .env.example                (env template)
├── .gitignore
├── package.json                (Next.js deps + scripts)
├── bun.lock                    (lockfile — use with `bun install`)
├── tsconfig.json
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── components.json             (shadcn/ui config)
├── Caddyfile                   (optional reverse-proxy config)
│
├── prisma/
│   └── schema.prisma           (22 normalized models)
│
├── db/                          (empty — SQLite DB created on first `prisma db push`)
│
├── public/                     (static assets)
│
├── src/                         (Next.js app)
│   ├── app/
│   │   ├── api/                (35+ API routes — auth, schools, lessons, scheduling, timetable, reports, excel, audit)
│   │   ├── layout.tsx          (RTL Arabic-first root layout)
│   │   └── page.tsx            (SPA shell — single route, internal pane routing)
│   ├── components/
│   │   ├── app-shell.tsx       (Header + sidebar + i18n + auth + keyboard shortcuts)
│   │   ├── providers.tsx       (TanStack Query provider)
│   │   ├── ui/                 (shadcn/ui components)
│   │   └── panes/              (16 feature panes — see below)
│   └── lib/
│       ├── i18n.ts             (Arabic + English dictionary)
│       ├── store.ts            (Zustand stores — lang, app, undo/redo)
│       ├── auth.ts             (JWT sessions + audit log helper)
│       ├── db.ts               (Prisma client)
│       └── scheduling/
│           ├── engine.ts       (TS reference solver + types)
│           ├── input-builder.ts (DB → SolverInput builder; reads Period.type=="SEVENTH")
│           └── provider.ts      (TypeScriptSolver / ORToolsSolver abstraction)
│
├── mini-services/
│   └── scheduler/               (Python OR-Tools CP-SAT microservice)
│       ├── README.md
│       ├── requirements.txt
│       ├── start.sh            (setsid -f launcher — survives Next.js reloads)
│       └── app/
│           ├── __init__.py
│           ├── main.py         (FastAPI entry: /solve /validate /swap /repair)
│           ├── models.py       (Pydantic schemas — SchoolIn.seventhPeriod, RepairRequest, RepairChange)
│           ├── solver/
│           │   ├── __init__.py
│           │   ├── model.py    (CP-SAT model — vars + H1-H11 + S1-S7; true gap calc)
│           │   ├── conflict_analyzer.py (pre-solver feasibility analysis)
│           │   ├── validator.py (independent post-solve validator)
│           │   ├── repair.py   (legacy swap engine)
│           │   ├── local_repair.py  (Phase 5+6: real CP-SAT local repair)
│           │   └── driver.py   (top-level solve driver; profile metadata)
│           └── tests/
│               ├── __init__.py
│               └── test_solver.py  (10 deterministic scenarios)
│
├── scripts/                    (TS + Python utilities)
│   ├── seed.ts                 (realistic demo dataset)
│   ├── check-db.ts             (debug query helper)
│   ├── debug.ts
│   ├── stress-test.py          (100 teachers × 1050 occurrences perf test)
│   ├── test-scheduler-direct.py
│   ├── test-scheduler-integration.py
│   ├── phase1_verify_ui.py     (Phase 1 acceptance)
│   ├── phase2_verify_periods.py (Phase 2 acceptance)
│   ├── phase3_profile.py       (Phase 3 profiling)
│   ├── phase9_seventh.py       (Phase 9 verification)
│   ├── phase10_repair_tests.py  (Phase 10: 8 repair scenarios)
│   └── acceptance_suite.py     (540/540 + 10 unit tests + integration)
│
└── tests/
    ├── database-runtime-build.sh
    ├── python-runtime-build.sh
    └── python-runtime-container.sh
```

## Feature Panes (16)

```
src/components/panes/
├── dashboard-pane.tsx          (real stats from DB)
├── school-pane.tsx             (multi-tenant school CRUD + periodsPerDay editor)
├── academic-pane.tsx           (grades, branches, sections)
├── subjects-pane.tsx
├── teachers-pane.tsx           (incl. availability dialog)
├── rooms-pane.tsx
├── lessons-pane.tsx
├── duties-pane.tsx
├── constraints-pane.tsx        (toggle hard/soft, set weights)
├── schedule-pane.tsx           (generation + validation + progress)
├── timetable-pane.tsx          (5 views + dnd-kit drag-drop + repair dialog)
├── conflicts-pane.tsx
├── reports-pane.tsx            (6 report tabs)
├── excel-pane.tsx              (9 export scopes)
├── audit-pane.tsx
└── settings-pane.tsx
```

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (Radix UI primitives)
- **Prisma ORM 6** (SQLite)
- **TanStack Query v5** (server state)
- **Zustand v5** (client state, undo/redo, navigation)
- **React Hook Form + Zod** (forms)
- **@dnd-kit/core** (drag-and-drop)
- **Recharts** (charts)
- **ExcelJS** (Excel export)
- **jsonwebtoken** (JWT sessions)
- **Google OR-Tools CP-SAT 9.15** (constraint optimization)
- **FastAPI 0.128** (Python microservice)
- **Pydantic 2.12** (request/response validation)
- **uvicorn 0.44** (ASGI server)

## API Endpoints

### Next.js API Routes (port 3000)

```
POST   /api/auth/login                  (JWT login, sets cookie)
POST   /api/auth/logout
GET    /api/auth/session

GET    /api/schools                     (multi-tenant list)
POST   /api/schools
GET    /api/schools/[id]
PUT    /api/schools/[id]                (edit periodsPerDay, workingDays, etc.)
DELETE /api/schools/[id]

GET    /api/grades, /api/branches, /api/sections
POST   /api/grades, /api/branches, /api/sections
GET    /api/subjects, /api/teachers, /api/rooms
POST   /api/subjects, /api/teachers, /api/rooms
GET    /api/lessons, /api/duties, /api/constraints
POST   /api/lessons, /api/duties, /api/constraints
GET    /api/teacher-subjects, /api/teacher-availability

POST   /api/scheduling/generate         (calls OR-Tools /solve, persists snapshot)
POST   /api/scheduling/validate         (calls OR-Tools /validate)

GET    /api/timetable/versions          (version snapshots)
POST   /api/timetable/versions          (duplicate / restore)
GET    /api/timetable/entries           (?versionId=&teacherId=&sectionId=&roomId=&subjectId=)
POST   /api/timetable/entries           (manual entry creation)
POST   /api/timetable/move              (drag-drop move with hard-constraint validation)
POST   /api/timetable/swap              (swap suggestion)
POST   /api/timetable/repair            (Phase 5: real local CP-SAT repair — does NOT commit)
POST   /api/timetable/lock              (per-entry lock)
POST   /api/timetable/undo              (TimetableChange-based undo)
POST   /api/timetable/redo

GET    /api/reports/{workload, conflicts, free-periods, duties, rooms, seventh, quality}

POST   /api/excel/export                (multi-sheet .xlsx with RTL)

GET    /api/dashboard                  (computed stats)
GET    /api/audit                       (audit log)
```

### Python Scheduler Microservice (port 3040)

```
GET    /health                          (liveness probe)

POST   /solve                           (full CP-SAT solve)
POST   /validate                        (independent timetable validation)
POST   /swap                            (legacy swap suggestion engine)
POST   /repair                          (Phase 5+6: real local CP-SAT repair)
```

## Environment Variables

Create a `.env` file in the project root:

```bash
# SQLite database URL — relative path inside the project
DATABASE_URL=file:./db/custom.db

# Python scheduler microservice URL
SCHEDULER_URL=http://127.0.0.1:3040

# Default solver provider — "ortools" (production) or "typescript" (fallback)
SCHEDULER_PROVIDER=ortools

# JWT secret (auto-generated if not set)
JWT_SECRET=change-this-to-a-long-random-string
```

## Troubleshooting

### Scheduler service not reachable
```bash
curl http://127.0.0.1:3040/health
# If connection refused: cd mini-services/scheduler && ./start.sh
# If still failing: tail -50 /tmp/scheduler.log
```

### Prisma client not generated
```bash
bunx prisma generate
bunx prisma db push --accept-data-loss
```

### Seed fails with "school not found"
Make sure you ran `bunx prisma db push` BEFORE `bun run scripts/seed.ts`. The DB file must exist.

### Next.js dev server crash
```bash
rm -rf .next node_modules
bun install
bun run dev
```

### OR-Tools install fails
```bash
pip3 install --upgrade pip
pip3 install ortools==9.15.6755
```
OR-Tools requires Python 3.10+. Check `python3 --version`.

### Local repair returns NO_REPAIR_FOUND
- Confirm the target `(day, period)` is in the school's working days and 1..periodsPerDay.
- Confirm the moved lesson is not LOCKED.
- Try increasing `repairRadius` (default 2) — but be aware this slows the solver.

## License

MIT — for educational and production use.

## Acknowledgments

- Google OR-Tools CP-SAT team for the world-class constraint solver.
- shadcn/ui for the beautiful component library.
- Next.js, Prisma, FastAPI, and the entire open-source ecosystem.
