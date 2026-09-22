"""Complete automated acceptance suite for the school timetable scheduling system.

Runs the following checks in order and prints a structured pass/fail report:

  A. OR-Tools unit test suite (10 deterministic scenarios in
     mini-services/scheduler/app/tests/test_solver.py)
  B. OR-Tools stress test (100 teachers / 50 sections / 1050 weekly occurrences
     in mini-services/scheduler/scripts/stress-test.py — re-uses the project's
     own stress script path)
  C. End-to-end feasibility test against the seeded school:
       1. Build solver input from the seeded DB (Next.js input builder)
       2. POST /solve with allowPartial=False and 60s time limit
          → assert status in (OPTIMAL, FEASIBLE)
          → assert feasible == True
          → assert scheduled == required == 540
          → assert 0 hard violations across all categories
          → assert 0 conflicts and 0 failures
       3. POST /validate with the produced entries
          → assert valid == True
          → assert hardViolations == 0
       4. Per-section / per-teacher / per-room independent sanity counts
  D. Independent conflict-detection cross-check (re-derives teacher/class/room
     conflict counts from the produced entries — must match solver report)
  E. Final pass/fail summary

Exit code 0 = all green; 1 = any failure.
"""
from __future__ import annotations
import json, os, subprocess, sys, time, urllib.request, urllib.error, traceback
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
WORK_DIR = Path("/home/z/my-project/work")
SCHED_URL = "http://127.0.0.1:3040"
SCHEDULER_DIR = WORK_DIR / "mini-services" / "scheduler"
ACCEPTANCE_LOG = Path("/home/z/my-project/download/acceptance_report.txt")
ACCEPTANCE_JSON = Path("/home/z/my-project/download/acceptance_report.json")
SOLVER_INPUT_JSON = Path("/tmp/solver_input.json")
SOLVER_RESPONSE_JSON = Path("/tmp/solver_response.json")
VALIDATE_RESPONSE_JSON = Path("/tmp/validate_response.json")

# Ensure /home/z/my-project/download exists
ACCEPTANCE_LOG.parent.mkdir(parents=True, exist_ok=True)

class Report:
    def __init__(self):
        self.sections: list[dict] = []
        self.current: dict | None = None

    def begin(self, name: str, description: str):
        self.current = {"name": name, "description": description,
                         "checks": [], "passed": False, "error": None}
        print(f"\n{'='*70}\n{description}\n{'='*70}")

    def check(self, label: str, ok: bool, detail: str = ""):
        if self.current is None:
            raise RuntimeError("check() called before begin()")
        self.current["checks"].append({"label": label, "ok": bool(ok), "detail": detail})
        symbol = "✓" if ok else "✗"
        line = f"  {symbol} {label}"
        if detail:
            line += f"  -- {detail}"
        print(line)

    def finish(self, passed: bool, error: str | None = None):
        if self.current is None:
            raise RuntimeError("finish() called before begin()")
        self.current["passed"] = bool(passed)
        self.current["error"] = error
        self.sections.append(self.current)
        result = "PASS" if passed else "FAIL"
        print(f"  → section result: {result}" + (f" ({error})" if error else ""))
        self.current = None

    def to_dict(self):
        return {"sections": self.sections,
                "passed": all(s["passed"] for s in self.sections),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z")}

# ---------------------------------------------------------------------------
def http_json(method: str, url: str, body: dict | None = None, timeout: int = 300) -> dict:
    headers = {"Content-Type": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())

def run(cmd: list[str], cwd: Path, timeout: int = 300) -> tuple[int, str, str]:
    """Run a subprocess and capture stdout/stderr. Returns (rc, out, err)."""
    try:
        r = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"

def build_solver_input_via_ts(report: Report) -> dict | None:
    """Run the Next.js input-builder TS module and dump the resulting JSON."""
    report.begin("build-input", "Build solver input from seeded DB via Next.js input-builder")
    shim = """
import { buildSolverInput } from '/home/z/my-project/work/src/lib/scheduling/input-builder';

(async () => {
  const { PrismaClient } = await import('/home/z/my-project/work/node_modules/@prisma/client');
  const db = new PrismaClient({ log: [] });
  const school = await db.school.findFirst({ where: { name: 'مدرسة النجاح الثانوية' } });
  if (!school) { console.error('school not found'); process.exit(1); }
  const r = await buildSolverInput(school.id);
  if ('error' in r) { console.error('input builder error:', r.error); process.exit(1); }
  const fs = await import('fs');
  fs.writeFileSync('/tmp/solver_input.json', JSON.stringify(r));
  await db.$disconnect();
})();
"""
    Path("/tmp/_shim.ts").write_text(shim)
    rc, out, err = run(["bun", "run", "/tmp/_shim.ts"], WORK_DIR, timeout=60)
    ok = rc == 0 and SOLVER_INPUT_JSON.exists()
    report.check("bun shim exits 0", rc == 0, f"rc={rc}")
    report.check("solver_input.json written", SOLVER_INPUT_JSON.exists())
    if not ok:
        report.finish(False, f"shim failed: stderr={err[:500]}")
        return None
    with open(SOLVER_INPUT_JSON) as f:
        req = json.load(f)
    days = [d.strip() for d in req["school"]["workingDays"].split(",") if d.strip()]
    ppd = req["school"]["periodsPerDay"]
    max_week_slots = len(days) * ppd
    sec_req = defaultdict(int)
    for l in req["lessons"]:
        sec_req[l["sectionId"]] += l["weeklyOccurrences"]
    total = sum(sec_req.values())
    over = {sid: n for sid, n in sec_req.items() if n > max_week_slots}
    report.check("school has 8 periods/day", ppd == 8, f"periodsPerDay={ppd}")
    report.check("school has 5 working days", len(days) == 5, f"days={days}")
    report.check("total required occurrences == 540", total == 540, f"got {total}")
    report.check("lesson count == 180", len(req["lessons"]) == 180, f"got {len(req['lessons'])}")
    report.check("duty count == 60", len(req["duties"]) == 60, f"got {len(req['duties'])}")
    report.check("teacher count == 30", len(req["teachers"]) == 30, f"got {len(req['teachers'])}")
    report.check("section count == 15", len(req["sections"]) == 15, f"got {len(req['sections'])}")
    report.check("room count == 23 (15 classrooms + 3 labs + 2 CS labs + gym + art + aud)",
                 len(req["rooms"]) == 23, f"got {len(req['rooms'])}")
    report.check("no section exceeds week slot capacity",
                 len(over) == 0, f"max_per_section={max(sec_req.values()) if sec_req else 0} slots={max_week_slots}")
    # All lab/practical/sport/activity lessons must have roomId=null
    bad_room = [l["id"] for l in req["lessons"]
                if l.get("roomId")
                and any(s["id"] == l["subjectId"] and s.get("requiredRoomType") for s in req["subjects"])]
    report.check("no lab/practical/sport/activity lesson pins a single roomId",
                 len(bad_room) == 0, f"bad_count={len(bad_room)}")
    report.finish(rc == 0 and total == 540 and not over and not bad_room)
    return req

# ---------------------------------------------------------------------------
def run_unit_tests(report: Report) -> bool:
    """Run the OR-Tools deterministic unit-test suite (10 scenarios)."""
    report.begin("unit-tests", "A. OR-Tools deterministic test suite (10 scenarios)")
    rc, out, err = run(["python3", "app/tests/test_solver.py"], SCHEDULER_DIR, timeout=120)
    # The runner prints "=== 10/10 passed, 0 failed ==="
    passed = rc == 0 and "10/10 passed" in out
    report.check("test_solver.py exits 0", rc == 0, f"rc={rc}")
    report.check("'10/10 passed' string found in stdout",
                 "10/10 passed" in out, f"stdout_tail={out[-300:]!r}")
    if not passed:
        report.check("failure detail", False, f"stderr={err[:500]}")
    report.finish(passed)
    return passed

def run_stress_test(report: Report) -> bool:
    """Run the OR-Tools stress test (100 teachers × 1050 weekly occurrences).

    The stress test is a PERFORMANCE measurement, not a feasibility regression —
    it constructs a synthetic 100-teacher / 50-section / 1050-occurrence model
    with a 30-second solver time limit. CP-SAT may legitimately return
    UNKNOWN on such a large model within 30s without that implying any
    infeasibility in the *seeded school* dataset.

    Pass criteria (all must hold):
      - script exits 0 (no crash, valid SolverResponse produced)
      - stdout contains 'Status:' and 'Quality score:' lines
      - hard violation counts are ALL zero (teacher / class / room /
        availability / duty / fixed / capacity) — even on a partial
        or empty solution, none of these may be > 0
      - status is one of OPTIMAL / FEASIBLE / INFEASIBLE / UNKNOWN
        (UNKNOWN = timeout; this is acceptable for a perf test)
    """
    report.begin("stress-test", "B. OR-Tools stress test (100 teachers / 50 sections / 1050 occurrences, 30s limit — perf measurement)")
    rc, out, err = run(["python3", "scripts/stress-test.py"], WORK_DIR, timeout=240)
    has_status = "Status:" in out
    has_quality = "Quality score:" in out
    scheduled_line = [l for l in out.splitlines() if "  Scheduled:" in l]
    scheduled = int(scheduled_line[0].split()[-1]) if scheduled_line else -1
    required_line = [l for l in out.splitlines() if "  Required:" in l]
    required = int(required_line[0].split()[-1]) if required_line else -1

    # Extract status string
    status_line = [l for l in out.splitlines() if l.startswith("Status:")]
    status_str = status_line[0].split(":", 1)[1].strip() if status_line else "MISSING"

    teacher_conf_line = [l for l in out.splitlines() if "Teacher conflicts:" in l]
    teacher_conf = int(teacher_conf_line[0].split()[-1]) if teacher_conf_line else -1
    class_conf_line = [l for l in out.splitlines() if "Class conflicts:" in l]
    class_conf = int(class_conf_line[0].split()[-1]) if class_conf_line else -1
    room_conf_line = [l for l in out.splitlines() if "Room conflicts:" in l]
    room_conf = int(room_conf_line[0].split()[-1]) if room_conf_line else -1
    avail_line = [l for l in out.splitlines() if "Availability violations:" in l]
    avail_viol = int(avail_line[0].split()[-1]) if avail_line else -1
    duty_line = [l for l in out.splitlines() if "Duty conflicts:" in l]
    duty_viol = int(duty_line[0].split()[-1]) if duty_line else -1
    fixed_line = [l for l in out.splitlines() if "Fixed violations:" in l]
    fixed_viol = int(fixed_line[0].split()[-1]) if fixed_line else -1
    cap_line = [l for l in out.splitlines() if "Capacity violations:" in l]
    cap_viol = int(cap_line[0].split()[-1]) if cap_line else -1

    status_ok = status_str in ("OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN",
                                "SolverStatus.OPTIMAL", "SolverStatus.FEASIBLE",
                                "SolverStatus.INFEASIBLE", "SolverStatus.UNKNOWN")
    no_hard_violations = (teacher_conf == 0 and class_conf == 0 and room_conf == 0
                          and avail_viol == 0 and duty_viol == 0
                          and fixed_viol == 0 and cap_viol == 0)
    # If solver returned a partial schedule, hard violations still must be 0.
    # If solver timed out (UNKNOWN, scheduled == 0), that is acceptable for a perf test.
    scheduled_ok = (scheduled > 0) or (status_str in ("UNKNOWN", "SolverStatus.UNKNOWN"))

    ok = (rc == 0 and has_status and has_quality and status_ok
          and no_hard_violations and scheduled_ok)

    report.check("stress-test exits 0 (no crash)", rc == 0, f"rc={rc}")
    report.check("stdout contains 'Status:' and 'Quality score:'", has_status and has_quality)
    report.check("status is OPTIMAL/FEASIBLE/INFEASIBLE/UNKNOWN (timeout tolerated)",
                 status_ok, f"status={status_str}")
    report.check("stress teacher conflicts == 0", teacher_conf == 0, f"value={teacher_conf}")
    report.check("stress class conflicts == 0", class_conf == 0, f"value={class_conf}")
    report.check("stress room conflicts == 0", room_conf == 0, f"value={room_conf}")
    report.check("stress availability violations == 0", avail_viol == 0, f"value={avail_viol}")
    report.check("stress duty conflicts == 0", duty_viol == 0, f"value={duty_viol}")
    report.check("stress fixed-lesson violations == 0", fixed_viol == 0, f"value={fixed_viol}")
    report.check("stress capacity violations == 0", cap_viol == 0, f"value={cap_viol}")
    report.check("scheduled > 0 OR status==UNKNOWN (timeout tolerated)",
                 scheduled_ok, f"scheduled={scheduled} required={required}")
    if not ok:
        report.check("stress failure detail", False, f"stderr={err[:500]}")
    report.finish(ok)
    return ok

def run_solve_e2e(report: Report, req: dict) -> dict | None:
    """End-to-end: POST /solve against the running scheduler and assert strict feasibility."""
    report.begin("solve-e2e",
                 "C. End-to-end /solve against the seeded school (540/540 strict feasibility)")
    # Force strict — allowPartial MUST be False
    body = {**req, "config": {"timeLimitSeconds": 90, "numWorkers": 8,
                              "profile": "BALANCED", "allowPartial": False}}
    t0 = time.time()
    try:
        resp = http_json("POST", f"{SCHED_URL}/solve", body, timeout=180)
    except Exception as e:
        report.check("POST /solve succeeded", False, f"error={e!r}")
        report.finish(False, f"solve exception: {e!r}")
        return None
    elapsed = time.time() - t0
    with open(SOLVER_RESPONSE_JSON, "w") as f:
        json.dump(resp, f, indent=2)

    status = resp.get("status")
    feasible = resp.get("feasible")
    partial = resp.get("partial", False)
    required = resp["stats"]["requiredOccurrences"]
    scheduled = resp["stats"]["scheduledOccurrences"]
    unscheduled = resp["stats"]["unscheduledOccurrences"]
    stats = resp["stats"]
    conflicts = resp.get("conflicts", [])
    failures = resp.get("failures", [])
    quality = resp.get("qualityScore")
    timing = {"model": resp.get("modelGenerationMs"), "solver": resp.get("solverMs"),
              "wall": resp.get("wallMs"), "memory": resp.get("memoryMb")}

    report.check("HTTP POST /solve returned 200 + JSON",
                 feasible is not None, f"elapsed={elapsed:.2f}s")
    report.check("status in (OPTIMAL, FEASIBLE)",
                 status in ("OPTIMAL", "FEASIBLE"), f"status={status}")
    report.check("strict feasible flag == True",
                 feasible is True, f"feasible={feasible}")
    report.check("partial flag == False (no partial scheduling allowed)",
                 partial is False, f"partial={partial}")
    report.check("required occurrences == 540",
                 required == 540, f"required={required}")
    report.check("scheduled occurrences == 540",
                 scheduled == 540, f"scheduled={scheduled}")
    report.check("unscheduled occurrences == 0",
                 unscheduled == 0, f"unscheduled={unscheduled}")
    report.check("teacher conflicts == 0",
                 stats["teacherConflicts"] == 0, f"value={stats['teacherConflicts']}")
    report.check("class conflicts == 0",
                 stats["classConflicts"] == 0, f"value={stats['classConflicts']}")
    report.check("room conflicts == 0",
                 stats["roomConflicts"] == 0, f"value={stats['roomConflicts']}")
    report.check("availability violations == 0",
                 stats["availabilityViolations"] == 0, f"value={stats['availabilityViolations']}")
    report.check("duty conflicts == 0",
                 stats["dutyConflicts"] == 0, f"value={stats['dutyConflicts']}")
    report.check("fixed-lesson violations == 0",
                 stats["fixedLessonViolations"] == 0, f"value={stats['fixedLessonViolations']}")
    report.check("capacity violations == 0",
                 stats["capacityViolations"] == 0, f"value={stats['capacityViolations']}")
    report.check("conflicts list is empty",
                 len(conflicts) == 0, f"len={len(conflicts)}")
    report.check("failures list is empty",
                 len(failures) == 0, f"len={len(failures)}")
    report.check("quality score >= 70",
                 quality is not None and quality >= 70, f"quality={quality}")
    report.check("wall time <= 180s",
                 timing["wall"] is not None and timing["wall"] <= 180000,
                 f"timing={timing}")
    all_ok = (feasible is True and partial is False and required == 540 and
              scheduled == 540 and unscheduled == 0 and
              stats["teacherConflicts"] == 0 and stats["classConflicts"] == 0 and
              stats["roomConflicts"] == 0 and stats["availabilityViolations"] == 0 and
              stats["dutyConflicts"] == 0 and stats["fixedLessonViolations"] == 0 and
              stats["capacityViolations"] == 0 and len(conflicts) == 0 and
              len(failures) == 0)
    report.finish(all_ok)
    return resp

def run_validate_e2e(report: Report, req: dict, solve_resp: dict) -> dict | None:
    """Independent /validate call — re-checks the produced timetable from scratch."""
    report.begin("validate-e2e", "D. Independent /validate re-check (validator never trusts solver)")
    body = {
        "school": req["school"],
        "teachers": req["teachers"],
        "sections": req["sections"],
        "subjects": [{**s, "preferredPeriods": s.get("preferredPeriods", []),
                       "forbiddenPeriods": s.get("forbiddenPeriods", [])} for s in req["subjects"]],
        "rooms": req["rooms"],
        "lessons": req["lessons"],
        "duties": req["duties"],
        "availability": req["availability"],
        "daysOff": req["daysOff"],
        "entries": solve_resp["entries"],
        "dutyEntries": solve_resp.get("dutyEntries", []),
    }
    try:
        v = http_json("POST", f"{SCHED_URL}/validate", body, timeout=60)
    except Exception as e:
        report.check("POST /validate succeeded", False, f"error={e!r}")
        report.finish(False, f"validate exception: {e!r}")
        return None
    with open(VALIDATE_RESPONSE_JSON, "w") as f:
        json.dump(v, f, indent=2)
    valid = v.get("valid")
    hard = v.get("hardViolations")
    issues = v.get("issues", [])
    vstats = v["stats"]
    report.check("HTTP POST /validate returned 200 + JSON", valid is not None)
    report.check("valid == True", valid is True, f"valid={valid}")
    report.check("hardViolations == 0", hard == 0, f"hardViolations={hard}")
    report.check("issues list is empty", len(issues) == 0, f"len={len(issues)}")
    report.check("validator required == 540",
                 vstats["requiredOccurrences"] == 540, f"required={vstats['requiredOccurrences']}")
    report.check("validator scheduled == 540",
                 vstats["scheduledOccurrences"] == 540, f"scheduled={vstats['scheduledOccurrences']}")
    report.check("validator teacher conflicts == 0",
                 vstats["teacherConflicts"] == 0, f"value={vstats['teacherConflicts']}")
    report.check("validator class conflicts == 0",
                 vstats["classConflicts"] == 0, f"value={vstats['classConflicts']}")
    report.check("validator room conflicts == 0",
                 vstats["roomConflicts"] == 0, f"value={vstats['roomConflicts']}")
    report.check("validator availability violations == 0",
                 vstats["availabilityViolations"] == 0, f"value={vstats['availabilityViolations']}")
    report.check("validator duty conflicts == 0",
                 vstats["dutyConflicts"] == 0, f"value={vstats['dutyConflicts']}")
    report.check("validator fixed-lesson violations == 0",
                 vstats["fixedLessonViolations"] == 0, f"value={vstats['fixedLessonViolations']}")
    report.check("validator capacity violations == 0",
                 vstats["capacityViolations"] == 0, f"value={vstats['capacityViolations']}")
    ok = (valid is True and hard == 0 and len(issues) == 0 and
          vstats["scheduledOccurrences"] == 540 and
          vstats["teacherConflicts"] == 0 and vstats["classConflicts"] == 0 and
          vstats["roomConflicts"] == 0 and vstats["availabilityViolations"] == 0 and
          vstats["dutyConflicts"] == 0 and vstats["fixedLessonViolations"] == 0 and
          vstats["capacityViolations"] == 0)
    report.finish(ok)
    return v

def run_independent_recount(report: Report, req: dict, solve_resp: dict) -> bool:
    """Independent conflict re-count from the entries list — pure Python recompute."""
    report.begin("recount", "E. Pure-Python independent re-count of conflicts")
    entries = solve_resp["entries"]
    # 1. required vs scheduled counts
    required_per_lesson = defaultdict(int)
    scheduled_per_lesson = defaultdict(int)
    for l in req["lessons"]:
        required_per_lesson[l["id"]] = l["weeklyOccurrences"]
    for e in entries:
        scheduled_per_lesson[e["lessonId"]] += 1
    under = [(lid, required_per_lesson[lid], scheduled_per_lesson[lid])
             for lid in required_per_lesson
             if scheduled_per_lesson[lid] != required_per_lesson[lid]]
    report.check("every lesson scheduled exactly its required # occurrences",
                 not under, f"mismatches={len(under)} sample={under[:3]}")

    # 2. Teacher conflict
    teacher_slot = defaultdict(list)
    for e in entries:
        teacher_slot[(e["teacherId"], e["day"], e["period"])].append(e)
    teacher_conflicts = sum(1 for v in teacher_slot.values() if len(v) > 1)
    report.check("independent teacher conflict count == 0",
                 teacher_conflicts == 0, f"value={teacher_conflicts}")

    # 3. Class conflict
    section_slot = defaultdict(list)
    for e in entries:
        section_slot[(e["sectionId"], e["day"], e["period"])].append(e)
    class_conflicts = sum(1 for v in section_slot.values() if len(v) > 1)
    report.check("independent class conflict count == 0",
                 class_conflicts == 0, f"value={class_conflicts}")

    # 4. Room conflict
    room_slot = defaultdict(list)
    for e in entries:
        if e.get("roomId"):
            room_slot[(e["roomId"], e["day"], e["period"])].append(e)
    room_conflicts = sum(1 for v in room_slot.values() if len(v) > 1)
    report.check("independent room conflict count == 0",
                 room_conflicts == 0, f"value={room_conflicts}")

    # 5. Day-off violations
    days_off = req["daysOff"]
    day_off_viol = 0
    for e in entries:
        if e["day"] in days_off.get(e["teacherId"], []):
            day_off_viol += 1
    report.check("day-off violations == 0", day_off_viol == 0, f"value={day_off_viol}")

    # 6. Duty conflict
    duty_slots = set()
    for d in req["duties"]:
        duty_slots.add((d["teacherId"], d["day"], d["period"]))
    duty_viol = sum(1 for e in entries
                    if (e["teacherId"], e["day"], e["period"]) in duty_slots)
    report.check("duty conflict violations == 0",
                 duty_viol == 0, f"value={duty_viol}")

    # 7. Total scheduled count
    report.check("len(entries) == 540",
                 len(entries) == 540, f"len={len(entries)}")

    ok = (not under and teacher_conflicts == 0 and class_conflicts == 0 and
          room_conflicts == 0 and day_off_viol == 0 and duty_viol == 0 and
          len(entries) == 540)
    report.finish(ok)
    return ok

# ---------------------------------------------------------------------------
def main():
    print("\n" + "=" * 70)
    print(" SCHOOL TIMETABLE — COMPLETE AUTOMATED ACCEPTANCE SUITE")
    print("=" * 70)
    print(f"Started at: {time.strftime('%Y-%m-%d %H:%M:%S')}")

    # Pre-flight: scheduler service must be up
    try:
        health = http_json("GET", f"{SCHED_URL}/health", timeout=5)
        print(f"  scheduler health: {health}")
    except Exception as e:
        print(f"  ✗ scheduler service is not reachable at {SCHED_URL}: {e}")
        print("    start it with: cd mini-services/scheduler && ./start.sh")
        return 1

    report = Report()

    # Step 1 — build solver input from DB
    req = build_solver_input_via_ts(report)
    if req is None:
        write_report(report)
        return 1

    # Step 2 — run the unit tests
    run_unit_tests(report)

    # Step 3 — end-to-end /solve against the seeded school
    solve_resp = run_solve_e2e(report, req)
    if solve_resp is None:
        write_report(report)
        return 1

    # Step 4 — independent /validate from scratch
    run_validate_e2e(report, req, solve_resp)

    # Step 5 — pure-Python re-count
    run_independent_recount(report, req, solve_resp)

    # Step 6 — stress test (run last because it takes ~30-60s)
    run_stress_test(report)

    return write_report(report)

def write_report(report: Report) -> int:
    """Write the final report to disk and return exit code."""
    data = report.to_dict()
    overall = data["passed"]
    ACCEPTANCE_LOG.write_text(render_text_report(data))
    ACCEPTANCE_JSON.write_text(json.dumps(data, indent=2))
    print("\n" + "=" * 70)
    print(" ACCEPTANCE SUITE SUMMARY")
    print("=" * 70)
    for s in data["sections"]:
        symbol = "✓" if s["passed"] else "✗"
        n_ok = sum(1 for c in s["checks"] if c["ok"])
        n_total = len(s["checks"])
        print(f"  {symbol} {s['name']}: {n_ok}/{n_total} checks  -- {s['description']}")
    print("-" * 70)
    print(f"  OVERALL: {'PASS ✅' if overall else 'FAIL ❌'}")
    print(f"  Report written to: {ACCEPTANCE_LOG}")
    print(f"  JSON written to:   {ACCEPTANCE_JSON}")
    return 0 if overall else 1

def render_text_report(data: dict) -> str:
    lines = []
    lines.append("SCHOOL TIMETABLE — AUTOMATED ACCEPTANCE REPORT")
    lines.append(f"Generated: {data['timestamp']}")
    lines.append("")
    for s in data["sections"]:
        symbol = "PASS" if s["passed"] else "FAIL"
        lines.append(f"[{symbol}] {s['name']} -- {s['description']}")
        for c in s["checks"]:
            mark = "ok " if c["ok"] else "FAIL"
            d = f"  ({c['detail']})" if c["detail"] else ""
            lines.append(f"    [{mark}] {c['label']}{d}")
        if s["error"]:
            lines.append(f"    error: {s['error']}")
        lines.append("")
    lines.append(f"OVERALL: {'PASS' if data['passed'] else 'FAIL'}")
    return "\n".join(lines)

if __name__ == "__main__":
    sys.exit(main())
