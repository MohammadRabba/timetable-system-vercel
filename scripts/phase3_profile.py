"""Phase 3 — Solver performance profiling.

Calls POST /solver/solve against the seeded school and reports per-stage
timings. Identifies the largest bottleneck.

Pipeline stages (all in ms):
  1. pre_analyze_ms       — pre-solver conflict analysis (Py iterative)
  2. occurrences_ms       — expand lessons → occurrences (540)
  3. teacher_slots_ms     — build teacher_allowed + teacher_occupied sets
  4. candidates_ms        — enumerate (day, period, room) candidate slots
                            per occurrence, pre-filtering impossible slots
  5. vars_ms              — create Boolean vars x[occ, cand_idx]
  6. hard_constraints_ms — H1 (teacher) + H2 (class) + H3 (room) + H10 (count)
  7. soft_constraints_ms — S1..S7 penalty terms + objective
  8. solver_ms            — CP-SAT Solve()
  9. extraction_ms        — read solution values → PlacedEntry list
 10. validation_ms       — independent_validate() from scratch
"""
from __future__ import annotations
import json, sys, time, urllib.request
from pathlib import Path

DOWNLOAD = Path("/home/z/my-project/download")
DOWNLOAD.mkdir(parents=True, exist_ok=True)
SCHED_URL = "http://127.0.0.1:3040"

def main():
    # Load the solver input we already saved in Phase 1
    with open("/tmp/solver_input.json") as f:
        req = json.load(f)

    # Force a strict solve (allowPartial=False) with a generous time limit
    req["config"] = {"timeLimitSeconds": 90, "numWorkers": 8,
                     "profile": "BALANCED", "allowPartial": False}
    print("=" * 70)
    print(" PHASE 3 — SOLVER PERFORMANCE PROFILING")
    print("=" * 70)
    print(f"Dataset: school={req['school']['name']}  periodsPerDay={req['school']['periodsPerDay']}")
    print(f"         teachers={len(req['teachers'])}  sections={len(req['sections'])}  "
          f"subjects={len(req['subjects'])}  rooms={len(req['rooms'])}")
    print(f"         lessons={len(req['lessons'])}  duties={len(req['duties'])}")
    total_required = sum(l["weeklyOccurrences"] for l in req["lessons"])
    print(f"         total_required_occurrences={total_required}")
    print(f"\nCalling POST {SCHED_URL}/solve (timeLimit=90s)...")
    t0 = time.time()
    data = json.dumps(req).encode()
    r = urllib.request.Request(f"{SCHED_URL}/solve", data=data,
                                headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(r, timeout=180) as resp:
        body = json.loads(resp.read().decode())
    print(f"Solved in {time.time()-t0:.2f}s (status={body['status']}, feasible={body['feasible']})")
    profile = body.get("profile", {})
    stages = profile.get("stages", {})

    # Compose the ordered stage list
    pipeline = [
        ("1. pre_analyze (Py iterative)", profile.get("pre_analyze_ms", 0)),
        ("2. occurrences (expand 540)", stages.get("occurrences_ms", 0)),
        ("3. teacher_slots (allowed+occupied)", stages.get("teacher_slots_ms", 0)),
        ("4. candidates (enumerate, pre-filter)", stages.get("candidates_ms", 0)),
        ("5. vars (Bool x[occ,cand])", stages.get("vars_ms", 0)),
        ("6. hard_constraints (H1+H2+H3+H10)", stages.get("hard_constraints_ms", 0)),
        ("7. soft_constraints (S1..S7+objective)", stages.get("soft_constraints_ms", 0)),
        ("8. solver (CP-SAT Solve())", body.get("solverMs", 0)),
        ("9. extraction (read values)", profile.get("extraction_ms", 0)),
        ("10. validation (independent_validate)", profile.get("validation_ms", 0)),
    ]
    total_ms = sum(t for _, t in pipeline)
    print(f"\n{'Stage':<45} {'ms':>10} {'%':>8}")
    print("-" * 65)
    for label, ms in pipeline:
        pct = (ms / total_ms * 100) if total_ms else 0
        bar = "█" * int(pct / 2)
        print(f"{label:<45} {ms:>10} {pct:>6.1f}%  {bar}")
    print("-" * 65)
    print(f"{'TOTAL':<45} {total_ms:>10} {100.0:>7.1f}%")

    # Reported wall time (may include some overhead not in stages)
    print(f"\nReported by solver:")
    print(f"  modelGenerationMs = {body['modelGenerationMs']}")
    print(f"  solverMs          = {body['solverMs']}")
    print(f"  wallMs            = {body['wallMs']}")
    print(f"  memoryMb          = {body['memoryMb']}")
    print(f"\nModel size:")
    print(f"  occurrences         = {profile.get('occurrences', 0)}")
    print(f"  candidate slots    = {profile.get('candidates', 0)}")
    print(f"  Boolean decision vars = {profile.get('num_bool_vars', 0)}")
    print(f"  hard constraints (H1+H2+H3+H10) = {profile.get('num_hard_constraints', 0)}")
    print(f"  objectiveValue      = {body.get('objectiveValue')}")

    # Identify bottleneck
    sorted_stages = sorted(pipeline, key=lambda x: -x[1])
    bottleneck = sorted_stages[0]
    print(f"\nLARGEST BOTTLENECK: {bottleneck[0]} = {bottleneck[1]} ms "
          f"({bottleneck[1]/total_ms*100:.1f}% of total)")

    # Save report
    report = {
        "dataset": {
            "teachers": len(req["teachers"]),
            "sections": len(req["sections"]),
            "subjects": len(req["subjects"]),
            "rooms": len(req["rooms"]),
            "lessons": len(req["lessons"]),
            "duties": len(req["duties"]),
            "total_required_occurrences": total_required,
            "periodsPerDay": req["school"]["periodsPerDay"],
            "workingDays": req["school"]["workingDays"],
        },
        "result": {
            "status": body["status"],
            "feasible": body["feasible"],
            "scheduled": body["stats"]["scheduledOccurrences"],
            "required": body["stats"]["requiredOccurrences"],
            "qualityScore": body["qualityScore"],
            "objectiveValue": body.get("objectiveValue"),
        },
        "timing": {
            "modelGenerationMs": body["modelGenerationMs"],
            "solverMs": body["solverMs"],
            "wallMs": body["wallMs"],
            "memoryMb": body["memoryMb"],
        },
        "model_size": {
            "occurrences": profile.get("occurrences", 0),
            "candidates": profile.get("candidates", 0),
            "num_bool_vars": profile.get("num_bool_vars", 0),
            "num_hard_constraints": profile.get("num_hard_constraints", 0),
        },
        "pipeline_stages_ms": dict(pipeline),
        "bottleneck": {"stage": bottleneck[0], "ms": bottleneck[1],
                       "pct_of_total": bottleneck[1] / total_ms * 100 if total_ms else 0},
    }
    with open(DOWNLOAD / "phase3_profile.json", "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nReport saved: {DOWNLOAD / 'phase3_profile.json'}")

if __name__ == "__main__":
    sys.exit(main())
