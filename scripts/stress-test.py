"""Stress test — generates a large synthetic dataset and runs the solver.

Spec:
    100 teachers
    50 sections
    20 subjects
    40 rooms
    1000+ weekly lesson occurrences
    7 periods/day, 5 working days
"""
import json
import random
import sys
import time
import urllib.request
import os
import tracemalloc

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mini-services", "scheduler"))
from app.solver import solve
from app.models import (SolverRequest, SchoolIn, TeacherIn, SectionIn, SubjectIn,
                         RoomIn, LessonIn, DutyIn, ConstraintIn, SolverConfig,
                        SolverStatus)


def gen_stress_dataset() -> SolverRequest:
    random.seed(42)  # deterministic
    NUM_TEACHERS = 100
    NUM_SECTIONS = 50
    NUM_SUBJECTS = 20
    NUM_ROOMS = 40
    PERIODS_PER_DAY = 7
    WORKING_DAYS = "SUN,MON,TUE,WED,THU"

    # Subjects — 5 require labs, 1 sport, 1 art, rest theory
    subjects = []
    for i in range(NUM_SUBJECTS):
        rt = None
        if i < 5: rt = "LABORATORY"
        elif i == 5: rt = "SPORTS_HALL"
        elif i == 6: rt = "ACTIVITY_ROOM"
        subjects.append(SubjectIn(
            id=f"SUB-{i}",
            name=f"Subject-{i}",
            type="LABORATORY" if rt == "LABORATORY" else "THEORY",
            defaultWeekly=3,
            maxPerDay=2,
            requiredRoomType=rt,
            preferredPeriods=[1, 2, 3],
            forbiddenPeriods=[],
            priority=100,
        ))

    # Rooms — 20 classrooms, 8 labs, 4 computer labs, 2 sports, 2 art, 4 special
    rooms = []
    for i in range(NUM_ROOMS):
        if i < 20:
            rt, cap = "CLASSROOM", 35
        elif i < 28:
            rt, cap = "LABORATORY", 30
        elif i < 32:
            rt, cap = "COMPUTER_LAB", 30
        elif i < 34:
            rt, cap = "SPORTS_HALL", 100
        elif i < 36:
            rt, cap = "ACTIVITY_ROOM", 30
        else:
            rt, cap = "SPECIAL", 25
        rooms.append(RoomIn(id=f"R-{i}", name=f"Room-{i}", type=rt, capacity=cap))

    # Teachers — each teaches 2 subjects, distributed round-robin
    teachers = []
    for i in range(NUM_TEACHERS):
        teachers.append(TeacherIn(
            id=f"T-{i}",
            name=f"Teacher-{i:03d}",
            requiredWorkload=18,
            maxDailyPeriods=7,
            minDailyPeriods=0,
            requiredSeventh=0,
            maxSeventh=3,
        ))

    # Sections
    sections = []
    for i in range(NUM_SECTIONS):
        sections.append(SectionIn(
            id=f"C-{i}",
            name=f"Class-{i:02d}",
            studentCount=random.randint(20, 30),
            roomId=None,
        ))

    # Teacher-subject qualifications: each subject taught by ~5 teachers
    subject_teachers = {s.id: [] for s in subjects}
    for i, t in enumerate(teachers):
        # Each teacher teaches 2 subjects, spread evenly
        s1 = subjects[i % NUM_SUBJECTS].id
        s2 = subjects[(i + 1) % NUM_SUBJECTS].id
        subject_teachers[s1].append(t.id)
        subject_teachers[s2].append(t.id)
    # Round-robin pointer per subject
    sptr = {s.id: 0 for s in subjects}

    # Lessons — each section gets all subjects with 3 weekly = 50 * 20 * 3 = 3000 occurrences
    # To hit ~1000 occurrences, use 50 sections × 7 subjects × 3 = 1050
    lessons = []
    for sec in sections:
        for sub in random.sample(subjects, 7):  # 7 subjects per section
            candidates = subject_teachers[sub.id]
            if not candidates:
                continue
            tid = candidates[sptr[sub.id] % len(candidates)]
            sptr[sub.id] += 1
            lessons.append(LessonIn(
                id=f"L-{sec.id}-{sub.id}",
                teacherId=tid,
                subjectId=sub.id,
                sectionId=sec.id,
                roomId=None,
                weeklyOccurrences=3,
                duration=1,
                lessonType=sub.type,
                priority=100,
                requiredConsecutive=0,
                preferredSlots="",
                forbiddenSlots="",
                fixed=False,
                fixedDay=None,
                fixedPeriod=None,
                locked=False,
                coTeacherId=None,
            ))

    # Availability — all available (no days off, no preferred)
    availability = {}
    daysOff = {}
    for t in teachers:
        availability[t.id] = {}
        # Give each teacher 1 day off (rotating)
        off_day = ["SUN", "MON", "TUE", "WED", "THU"][int(t.id.split("-")[1]) % 5]
        daysOff[t.id] = [off_day]

    # Constraints — defaults
    constraints = [
        ConstraintIn(code="HARD_TEACHER_CONFLICT", type="HARD", weight=1000000, enabled=True),
        ConstraintIn(code="HARD_CLASS_CONFLICT", type="HARD", weight=1000000, enabled=True),
        ConstraintIn(code="HARD_ROOM_CONFLICT", type="HARD", weight=1000000, enabled=True),
        ConstraintIn(code="SOFT_MIN_TEACHER_GAPS", type="SOFT", weight=100, enabled=True),
        ConstraintIn(code="SOFT_SEVENTH_EQUAL", type="SOFT", weight=500, enabled=True),
        ConstraintIn(code="SOFT_PREFERRED_PERIODS", type="SOFT", weight=100, enabled=True),
    ]

    total_required = sum(l.weeklyOccurrences for l in lessons)
    print(f"Stress dataset: {len(teachers)} teachers, {len(sections)} sections, "
          f"{len(subjects)} subjects, {len(rooms)} rooms, "
          f"{len(lessons)} lessons, {total_required} weekly occurrences")

    return SolverRequest(
        school=SchoolIn(id="STRESS", name="Stress School",
                         workingDays=WORKING_DAYS, periodsPerDay=PERIODS_PER_DAY),
        teachers=teachers,
        sections=sections,
        subjects=subjects,
        rooms=rooms,
        lessons=lessons,
        duties=[],
        availability=availability,
        daysOff=daysOff,
        constraints=constraints,
        config=SolverConfig(timeLimitSeconds=30, numWorkers=8, profile="BALANCED",
                             allowPartial=True),
    )


def main() -> int:
    print("\n=== STRESS TEST ===")
    print("Building dataset...")
    t0 = time.time()
    req = gen_stress_dataset()
    print(f"Dataset built in {time.time()-t0:.2f}s")

    print("\nRunning solver (30s time limit)...")
    tracemalloc.start()
    t1 = time.time()
    result = solve(req)
    elapsed = time.time() - t1
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    print(f"\n=== STRESS TEST RESULTS ===")
    print(f"Status: {result.status}")
    print(f"Feasible: {result.feasible}")
    print(f"Partial: {result.partial}")
    print(f"Quality score: {result.qualityScore}")
    print(f"Soft penalty: {result.softPenalty}")
    if result.objectiveValue is not None:
        print(f"Objective value: {result.objectiveValue}")
    print(f"\nTiming:")
    print(f"  Model build: {result.modelGenerationMs} ms")
    print(f"  Solver:      {result.solverMs} ms")
    print(f"  Wall:        {result.wallMs} ms")
    print(f"  Stress test elapsed: {elapsed:.2f} s")
    print(f"  Peak memory: {peak/1024/1024:.1f} MB"
          f" (reported: {result.memoryMb} MB)")
    print(f"\nOccurrences:")
    print(f"  Required:  {result.stats.requiredOccurrences}")
    print(f"  Scheduled: {result.stats.scheduledOccurrences}")
    print(f"  Unscheduled: {result.stats.unscheduledOccurrences}")
    print(f"\nHard violations:")
    print(f"  Teacher conflicts: {result.stats.teacherConflicts}")
    print(f"  Class conflicts: {result.stats.classConflicts}")
    print(f"  Room conflicts: {result.stats.roomConflicts}")
    print(f"  Availability violations: {result.stats.availabilityViolations}")
    print(f"  Duty conflicts: {result.stats.dutyConflicts}")
    print(f"  Fixed violations: {result.stats.fixedLessonViolations}")
    print(f"  Capacity violations: {result.stats.capacityViolations}")
    print(f"\nSoft metrics:")
    print(f"  Teacher gaps: {result.stats.teacherGaps}")
    print(f"  Seventh deviation: {result.stats.seventhDeviation}")
    print(f"  Subject cluster: {result.stats.subjectCluster}")
    print(f"  Workload deviation: {result.stats.workloadDeviation}")
    print(f"  Unwanted slots: {result.stats.unwantedSlots}")
    print(f"\nFailures: {len(result.failures)}")
    print(f"Conflicts: {len(result.conflicts)}")
    if result.suggestions:
        print("Suggestions:")
        for s in result.suggestions[:5]:
            print(f"  - {s}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
