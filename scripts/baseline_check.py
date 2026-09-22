"""Baseline check — proves the existing seed dataset is INFEASIBLE.
Builds the solver request directly from the seeded DB via the Next.js
input builder, prints diagnostics, then runs the OR-Tools solver with
strict criteria (allowPartial=False).
"""
import os, sys, json, subprocess, time
sys.path.insert(0, "/home/z/my-project/work/mini-services/scheduler")

# Use absolute paths so the shim doesn't depend on the TS module resolution.
shim = """
import { buildSolverInput } from '/home/z/my-project/work/src/lib/scheduling/input-builder';

(async () => {
  const { PrismaClient } = await import('/home/z/my-project/work/node_modules/@prisma/client');
  const db = new PrismaClient({ log: [] });
  const school = await db.school.findFirst({ where: { name: 'مدرسة النجاح الثانوية' } });
  if (!school) { console.error('school not found'); process.exit(1); }
  const r = await buildSolverInput(school.id);
  if ('error' in r) { console.error('input builder error:', r.error); process.exit(1); }
  // Write to a file so we don't fight with stdout noise
  const fs = await import('fs');
  fs.writeFileSync('/tmp/solver_input.json', JSON.stringify(r));
  await db.$disconnect();
})();
"""
with open('/tmp/_shim.ts', 'w') as f:
    f.write(shim)
result = subprocess.run(
    ['bun', 'run', '/tmp/_shim.ts'],
    cwd='/home/z/my-project/work', capture_output=True, text=True, timeout=60,
    env={**os.environ, 'PRisma_LOG': 'none'}
)
if result.returncode != 0 or not os.path.exists('/tmp/solver_input.json'):
    print("STDERR:", result.stderr[:3000])
    print("STDOUT:", result.stdout[:1000])
    sys.exit(1)

with open('/tmp/solver_input.json') as f:
    req = json.load(f)

days = [d.strip() for d in req['school']['workingDays'].split(',') if d.strip()]
ppd = req['school']['periodsPerDay']
max_week_slots = len(days) * ppd
print(f"\n=== BASELINE DIAGNOSTIC (current seed) ===")
print(f"School: {req['school']['name']}")
print(f"Working days: {days}  ({len(days)} days)")
print(f"Periods/day: {ppd}")
print(f"Max slots/section/week: {max_week_slots}")
print(f"Teachers: {len(req['teachers'])}")
print(f"Sections: {len(req['sections'])}")
print(f"Subjects: {len(req['subjects'])}")
print(f"Rooms: {len(req['rooms'])}")
print(f"Lessons: {len(req['lessons'])}")
print(f"Duties: {len(req['duties'])}")

from collections import defaultdict
sec_req = defaultdict(int)
for l in req['lessons']:
    sec_req[l['sectionId']] += l['weeklyOccurrences']
total_req = sum(sec_req.values())
print(f"\nTotal weekly occurrences required: {total_req}")
print(f"Section count: {len(sec_req)}")
print(f"Per-section max slots: {max_week_slots}")
infeasible_sections = {sid: n for sid, n in sec_req.items() if n > max_week_slots}
print(f"Sections whose requirements EXCEED max slots: {len(infeasible_sections)}")
for sid, n in list(infeasible_sections.items())[:5]:
    print(f"  Section {sid}: requires {n} but only {max_week_slots} slots exist")

room_type_capacity = defaultdict(int)
for r in req['rooms']:
    room_type_capacity[r['type']] += max_week_slots
subject_room_load = defaultdict(int)
for sub in req['subjects']:
    if sub.get('requiredRoomType'):
        for l in req['lessons']:
            if l['subjectId'] == sub['id']:
                subject_room_load[sub['requiredRoomType']] += l['weeklyOccurrences']
print(f"\n=== ROOM-TYPE LOAD ANALYSIS ===")
for rt, load in subject_room_load.items():
    cap = room_type_capacity.get(rt, 0)
    flag = "OK" if load <= cap else "INFEASIBLE"
    print(f"  {rt}: load={load} occurrences, capacity={cap} slots  -> {flag}")

# Also check explicit roomId overloading
print(f"\n=== EXPLICIT ROOM ASSIGNMENT OVERLOADING ===")
room_load = defaultdict(int)
for l in req['lessons']:
    if l.get('roomId'):
        room_load[l['roomId']] += l['weeklyOccurrences']
for rid, load in sorted(room_load.items(), key=lambda x: -x[1])[:5]:
    room = next((r for r in req['rooms'] if r['id'] == rid), None)
    cap = max_week_slots
    flag = "OK" if load <= cap else "OVERLOADED"
    print(f"  Room {rid} ({room['name'] if room else '?'} type={room['type'] if room else '?'}): load={load}, capacity={cap} slots -> {flag}")

from app.models import SolverRequest, SolverConfig
req_obj = SolverRequest(**{**req, 'config': SolverConfig(timeLimitSeconds=60, numWorkers=8, profile='BALANCED', allowPartial=False)})
from app.solver import solve
t0 = time.time()
resp = solve(req_obj)
elapsed = time.time() - t0
print(f"\n=== SOLVER RESULT (baseline, original seed) ===")
print(f"Status: {resp.status}")
print(f"Feasible: {resp.feasible}")
print(f"Partial: {resp.partial}")
print(f"Required: {resp.stats.requiredOccurrences}")
print(f"Scheduled: {resp.stats.scheduledOccurrences}")
print(f"Unscheduled: {resp.stats.unscheduledOccurrences}")
print(f"Hard violations: teacher={resp.stats.teacherConflicts} class={resp.stats.classConflicts} room={resp.stats.roomConflicts} avail={resp.stats.availabilityViolations} duty={resp.stats.dutyConflicts} fixed={resp.stats.fixedLessonViolations} capacity={resp.stats.capacityViolations}")
print(f"Quality: {resp.qualityScore}")
print(f"Wall: {resp.wallMs}ms  (elapsed {elapsed:.2f}s)")
print(f"Failures: {len(resp.failures)}")
for f in resp.failures[:10]:
    print(f"  - [{f.scope}] {f.reason}")
    print(f"    suggestion: {f.suggestion}")
print(f"Conflicts: {len(resp.conflicts)}")
