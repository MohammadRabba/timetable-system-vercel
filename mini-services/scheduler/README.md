# School Timetable CP-SAT Solver

Production-grade scheduling microservice built on **Google OR-Tools CP-SAT**, exposed through **FastAPI**.

## Architecture

```
Next.js API route (TypeScript)
   │
   │  HTTP POST /solve with full SolverRequest
   ▼
Python FastAPI service  ──┐
   │                      │ stateless — no DB access
   ▼                      │
┌──────────────────────┐  │ response: full SolverResponse
│  pre_analyze()       │  │
│      ↓               │  │
│  build_model()       │  │
│      ↓               │  │
│  CpSolver.Solve()    │  │
│      ↓               │  │
│  extract solution    │  │
│      ↓               │  │
│  independent_validate() │ ◄── re-checks from scratch
│      ↓               │  │
│  compute stats,      │  │
│  soft penalty,       │  │
│  quality score       │  │
│      ↓               │  │
│  build suggestions   │  │
└──────────────────────┘
```

## Strict Success Criteria

A timetable generation is **successful** ONLY when:

```
required_occurrences == scheduled_occurrences
AND
hard_constraint_violations == 0
```

The service reports one of:
- `OPTIMAL` — CP-SAT found the mathematically optimal solution
- `FEASIBLE` — a valid solution was found (not necessarily optimal)
- `INFEASIBLE` — no complete solution exists given the constraints
- `UNKNOWN` — solver ran out of time without a definitive answer
- `MODEL_INVALID` — model construction was invalid

The `feasible` boolean in the response is `true` ONLY when both criteria above hold. Partial timetables are flagged separately via `partial=true` — and only when the client explicitly passed `allowPartial=true`.

## Decision Variables

For each weekly occurrence `o` of every lesson, and for each candidate `(day, period, room)` slot `s` that respects:

- teacher availability / day-off / duty conflict
- subject forbidden periods
- lesson-level forbidden slots
- room type compatibility (lab/practical/sport/activity)
- room capacity (>= section.studentCount)

…we create a Boolean:

```
x[o, s] ∈ {0, 1}
```

where `x[o, s] = 1` means occurrence `o` occupies slot `s`.

**Model-size optimization:** for theory subjects (no `requiredRoomType`) the room dimension is collapsed — each occurrence gets exactly one room (the section's home room or first compatible classroom). For lab/practical/sport/activity subjects, all compatible rooms are enumerated.

## Hard Constraints

| Code | Constraint |
| --- | --- |
| H1  | Teacher conflict — no two occurrences share `(teacher, day, period)` |
| H2  | Class conflict — no two occurrences share `(section, day, period)` |
| H3  | Room conflict — no two occurrences share `(room, day, period)` |
| H4  | Teacher availability — candidates exclude forbidden/unavailable slots |
| H5  | Teacher day off — candidates exclude day-off slots |
| H6  | Duty conflict — candidates exclude duty slots |
| H7  | Fixed lessons — fixed occurrences get a single candidate slot |
| H8  | Room compatibility — only compatible rooms enumerated |
| H9  | Room capacity — only sufficient-capacity rooms enumerated |
| H10 | Weekly occurrence count — each occurrence placed exactly once |
| H11 | Teacher qualification — only qualified teachers appear in lesson.teacherId |

## Soft Constraints (weighted, minimized)

| Code | Penalty |
| --- | --- |
| S1  | Teacher gaps — idle periods between teaching |
| S2  | Subject clustering — multiple same-subject occurrences in same (section, day) |
| S3  | Unbalanced daily load — per-teacher daily count spread |
| S4  | Seventh-period imbalance — sum\|seventh_count - target\| |
| S5  | Unwanted periods — non-preferred period usage |
| S6  | Teacher preferences — reward preferred periods (negative penalty) |
| S7  | Consecutive lessons — reward configured consecutive runs |

## API

### `POST /solve`

Request body: full `SolverRequest` (see `app/models.py`).
Response: full `SolverResponse` with entries, stats, conflicts, failures, suggestions, timing.

### `POST /validate`

Independent validator — takes a complete timetable snapshot + requirement set and validates from scratch. Never assumes the solver was correct.

### `POST /swap`

Swap suggestion engine — given a target move, returns ranked alternative slots that maintain hard constraints.

### `POST /repair`

Local repair — given a manually-moved occurrence, finds the best repair target so the rest of the timetable is not regenerated.

## Run

```bash
cd mini-services/scheduler
pip3 install -r requirements.txt
./start.sh    # starts uvicorn on port 3040 with setsid -f (survives Next.js reloads)
```

Verify:
```bash
curl http://127.0.0.1:3040/health
# {"ok": true, "service": "scheduler", "engine": "ortools-cp-sat"}
```

## Tests

```bash
cd mini-services/scheduler
python3 app/tests/test_solver.py
```

10 deterministic scenarios covering: feasibility, teacher/class/room conflicts, day-off, workload, lab compatibility, fixed lessons, seventh-period balancing, and infeasibility explanation.

## Stress Test

```bash
python3 scripts/stress-test.py
```

Generates 100 teachers × 50 sections × 20 subjects × 40 rooms × 1050 weekly occurrences and measures model build time, solver time, scheduled count, hard violations, soft penalty, and memory.

## File Layout

```
mini-services/scheduler/
├── app/
│   ├── __init__.py
│   ├── main.py                  # FastAPI entry point
│   ├── models.py                # Pydantic request/response schemas
│   ├── solver/
│   │   ├── __init__.py
│   │   ├── model.py             # CP-SAT model builder (decision vars + constraints)
│   │   ├── conflict_analyzer.py # Pre-solver feasibility analysis
│   │   ├── validator.py         # Independent post-solve validator
│   │   ├── repair.py            # Swap suggestion engine
│   │   └── driver.py            # Top-level solve driver
│   └── tests/
│       ├── __init__.py
│       └── test_solver.py       # 10 deterministic test scenarios
├── requirements.txt
├── start.sh                     # setsid -f launcher (survives Next.js reloads)
└── README.md
```

## Integration with Next.js

The Next.js backend (`src/lib/scheduling/provider.ts`) defines a `SchedulingProvider` interface with two implementations:

- `TypeScriptSolver` — the original TypeScript backtracking engine (kept as fallback/reference)
- `ORToolsSolver` — calls this Python service over HTTP

The default provider is `ORToolsSolver`. Override with the env var `SCHEDULER_PROVIDER=typescript` to use the fallback. Per-request override is also possible via the `provider` field in the `POST /api/scheduling/generate` body.

The Python service is **stateless** — it never touches the Prisma database directly. The Next.js backend remains the source of truth for persistence, and wraps every save in a Prisma `$transaction` so a partial failure rolls back the entire generation.
