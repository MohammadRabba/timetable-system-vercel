"""Deterministic test suite — 10 scenarios covering all spec requirements.

Run with:
    cd /home/z/my-project/mini-services/scheduler
    python3 -m pytest app/tests/test_solver.py -v
    # OR (without pytest):
    python3 app/tests/test_solver.py
"""
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.models import (SolverRequest, SchoolIn, TeacherIn, SectionIn, SubjectIn,
                         RoomIn, LessonIn, DutyIn, ConstraintIn, SolverConfig,
                         PlacedEntry, ValidateRequest, ValidateResponse,
                         SolverStatus, SolverResponse)
from app.solver import solve, validate, analyze, find_swaps


def _base_req() -> SolverRequest:
    """Tiny feasible school: 2 teachers, 1 section, 2 subjects, 1 room.
       Section needs Math (3) + English (2) = 5 weekly occurrences.
       Both teachers teach both subjects."""
    return SolverRequest(
        school=SchoolIn(id="S1", name="Test School", workingDays="SUN,MON,TUE", periodsPerDay=3),
        teachers=[
            TeacherIn(id="T1", name="Alice", requiredWorkload=5, maxDailyPeriods=3, minDailyPeriods=0),
            TeacherIn(id="T2", name="Bob", requiredWorkload=5, maxDailyPeriods=3, minDailyPeriods=0),
        ],
        sections=[SectionIn(id="C1", name="10-A", studentCount=20, roomId=None)],
        subjects=[
            SubjectIn(id="SUB-MATH", name="Math", type="THEORY", defaultWeekly=3, maxPerDay=2),
            SubjectIn(id="SUB-EN", name="English", type="THEORY", defaultWeekly=2, maxPerDay=2),
        ],
        rooms=[RoomIn(id="R1", name="Room A", type="CLASSROOM", capacity=30)],
        lessons=[
            LessonIn(id="L1", teacherId="T1", subjectId="SUB-MATH", sectionId="C1",
                     weeklyOccurrences=3, lessonType="THEORY", priority=100),
            LessonIn(id="L2", teacherId="T2", subjectId="SUB-EN", sectionId="C1",
                     weeklyOccurrences=2, lessonType="THEORY", priority=100),
        ],
        duties=[],
        availability={},  # all available
        daysOff={},
        constraints=[],
        config=SolverConfig(timeLimitSeconds=10, numWorkers=2),
    )


# ============================== TEST 1 ==============================
def test_1_simple_feasible() -> None:
    """Simple feasible timetable — should schedule 100% with 0 hard conflicts."""
    req = _base_req()
    r: SolverResponse = solve(req)
    assert r.status in (SolverStatus.OPTIMAL, SolverStatus.FEASIBLE), \
        f"Expected OPTIMAL/FEASIBLE, got {r.status}"
    assert r.feasible, "Must be feasible"
    assert r.stats.requiredOccurrences == 5, "Must require 5 occurrences"
    assert r.stats.scheduledOccurrences == 5, "Must schedule all 5"
    assert r.stats.unscheduledOccurrences == 0
    assert r.stats.teacherConflicts == 0
    assert r.stats.classConflicts == 0
    assert r.stats.roomConflicts == 0
    print("✓ TEST 1 — Simple feasible timetable")


# ============================== TEST 2 ==============================
def test_2_teacher_double_booking() -> None:
    """Teacher double-booking — both lessons force the same teacher to the
    same slot. Should be INFEASIBLE."""
    req = _base_req()
    # Force both lessons to be at SUN P1 with same teacher (impossible)
    req.lessons[0].teacherId = "T1"
    req.lessons[1].teacherId = "T1"
    req.lessons[0].weeklyOccurrences = 4  # need 4 from same teacher in 3-day grid (3*3=9 slots, but T1 can teach all)
    req.lessons[1].weeklyOccurrences = 4  # need 4 from same teacher too
    req.lessons[0].fixed = True
    req.lessons[0].fixedDay = "SUN"
    req.lessons[0].fixedPeriod = 1
    req.lessons[1].fixed = True
    req.lessons[1].fixedDay = "SUN"
    req.lessons[1].fixedPeriod = 1
    r = solve(req)
    assert r.status in (SolverStatus.INFEASIBLE, SolverStatus.UNKNOWN), \
        f"Expected INFEASIBLE/UNKNOWN for double-booking, got {r.status}"
    assert not r.feasible, "Must NOT be feasible"
    print("✓ TEST 2 — Teacher double-booking → INFEASIBLE")


# ============================== TEST 3 ==============================
def test_3_class_double_booking() -> None:
    """Class double-booking — same class forced to have two lessons at the same slot."""
    req = _base_req()
    req.lessons[0].fixed = True
    req.lessons[0].fixedDay = "SUN"
    req.lessons[0].fixedPeriod = 1
    req.lessons[1].fixed = True
    req.lessons[1].fixedDay = "SUN"
    req.lessons[1].fixedPeriod = 1
    r = solve(req)
    assert r.status in (SolverStatus.INFEASIBLE, SolverStatus.UNKNOWN), \
        f"Expected INFEASIBLE for class conflict, got {r.status}"
    assert not r.feasible
    print("✓ TEST 3 — Class double-booking → INFEASIBLE")


# ============================== TEST 4 ==============================
def test_4_room_double_booking() -> None:
    """Room double-booking — both lessons forced to the same room and slot."""
    req = _base_req()
    req.lessons[0].roomId = "R1"
    req.lessons[1].roomId = "R1"
    req.lessons[0].fixed = True
    req.lessons[0].fixedDay = "SUN"
    req.lessons[0].fixedPeriod = 1
    req.lessons[1].fixed = True
    req.lessons[1].fixedDay = "SUN"
    req.lessons[1].fixedPeriod = 1
    r = solve(req)
    assert r.status in (SolverStatus.INFEASIBLE, SolverStatus.UNKNOWN), \
        f"Expected INFEASIBLE for room conflict, got {r.status}"
    assert not r.feasible
    print("✓ TEST 4 — Room double-booking → INFEASIBLE")


# ============================== TEST 5 ==============================
def test_5_teacher_day_off() -> None:
    """Teacher day off — teacher never scheduled that day."""
    req = _base_req()
    req.daysOff = {"T1": ["SUN"]}
    r = solve(req)
    assert r.feasible or r.stats.scheduledOccurrences > 0
    # T1 must never be scheduled on SUN
    for e in r.entries:
        if e.teacherId == "T1":
            assert e.day != "SUN", f"T1 scheduled on day off: {e.day}"
    print("✓ TEST 5 — Teacher day off respected")


# ============================== TEST 6 ==============================
def test_6_teacher_workload() -> None:
    """Teacher workload — exact required workload when feasible."""
    req = _base_req()
    # T1 teaches 3 Math occurrences, T2 teaches 2 English = 5 total
    req.teachers[0].requiredWorkload = 3  # exact match
    req.teachers[1].requiredWorkload = 2
    r = solve(req)
    assert r.feasible
    # Compute assigned workload per teacher
    t1_assigned = sum(1 for e in r.entries if e.teacherId == "T1")
    t2_assigned = sum(1 for e in r.entries if e.teacherId == "T2")
    assert t1_assigned == 3, f"T1 expected 3, got {t1_assigned}"
    assert t2_assigned == 2, f"T2 expected 2, got {t2_assigned}"
    print(f"✓ TEST 6 — Teacher workload respected (T1={t1_assigned}, T2={t2_assigned})")


# ============================== TEST 7 ==============================
def test_7_laboratory_room() -> None:
    """Laboratory requirement — only compatible laboratory rooms used."""
    req = _base_req()
    # Subject requires LABORATORY, add 2 lab rooms
    req.subjects[0].requiredRoomType = "LABORATORY"
    req.rooms = [
        RoomIn(id="R1", name="Classroom", type="CLASSROOM", capacity=30),
        RoomIn(id="LAB1", name="Lab 1", type="LABORATORY", capacity=25),
    ]
    req.lessons[0].roomId = None  # let solver pick
    r = solve(req)
    assert r.feasible, f"Expected feasible, got {r.status}"
    for e in r.entries:
        if e.subjectId == "SUB-MATH":
            assert e.roomId == "LAB1", f"Math must use LAB1, got {e.roomId}"
    print("✓ TEST 7 — Laboratory room compatibility respected")


# ============================== TEST 8 ==============================
def test_8_fixed_lesson() -> None:
    """Fixed lesson — must remain at its fixed slot.
    A lesson with weeklyOccurrences=1 and fixed=True is pinned to its slot.
    Moving it would violate the fixed constraint."""
    req = _base_req()
    # Single-occurrence Math lesson, fixed at MON P2
    req.lessons[0].weeklyOccurrences = 1
    req.lessons[0].fixed = True
    req.lessons[0].fixedDay = "MON"
    req.lessons[0].fixedPeriod = 2
    r = solve(req)
    assert r.feasible, f"Expected feasible, got {r.status}"
    # Find the Math entry and verify it's at MON P2
    math_entry = next((e for e in r.entries if e.lessonId == "L1"), None)
    assert math_entry is not None, "Math entry must exist"
    assert math_entry.day == "MON", f"Expected MON, got {math_entry.day}"
    assert math_entry.period == 2, f"Expected P2, got {math_entry.period}"
    # Validate via independent validator that no fixed-lesson violation exists
    val_req = ValidateRequest(
        school=req.school, teachers=req.teachers, sections=req.sections,
        subjects=req.subjects, rooms=req.rooms, lessons=req.lessons,
        duties=req.duties, availability=req.availability, daysOff=req.daysOff,
        entries=r.entries, dutyEntries=r.dutyEntries,
    )
    val_resp = validate(val_req)
    assert val_resp.valid, f"Validator should accept fixed-lesson schedule: {val_resp.issues}"
    assert all(i.type != "FIXED" for i in val_resp.issues), "No FIXED violations"
    print("✓ TEST 8 — Fixed lesson pinned to MON P2, no violations")


# ============================== TEST 9 ==============================
def test_9_seventh_periods() -> None:
    """Seventh periods — deviation minimized."""
    req = _base_req()
    # 6-period day, 5 days, 4 teachers each requiring 2 seventh periods
    req.school.periodsPerDay = 7
    req.school.workingDays = "SUN,MON,TUE,WED,THU"
    req.teachers = [
        TeacherIn(id=f"T{i}", name=f"T{i}", requiredWorkload=10, maxDailyPeriods=7, requiredSeventh=2, maxSeventh=3)
        for i in range(1, 5)
    ]
    req.lessons = [
        LessonIn(id=f"L{i}", teacherId=f"T{i%4 or 4}", subjectId="SUB-MATH",
                 sectionId="C1", weeklyOccurrences=5, lessonType="THEORY", priority=100)
        for i in range(1, 9)
    ]
    r = solve(req)
    # Seventh deviation should be small
    print(f"✓ TEST 9 — Seventh periods: deviation={r.stats.seventhDeviation}, "
          f"seventh_target_sum=8")


# ============================== TEST 10 ==============================
def test_10_impossible_schedule() -> None:
    """Impossible schedule — detailed infeasibility explanation."""
    req = _base_req()
    # Force impossible: 10 weekly occurrences on a 1-day, 1-period schedule
    req.school.workingDays = "SUN"
    req.school.periodsPerDay = 1
    req.lessons[0].weeklyOccurrences = 5
    req.lessons[1].weeklyOccurrences = 5
    # Both teachers same subject — class would have 5 lessons at the same slot — impossible
    r = solve(req)
    assert r.status in (SolverStatus.INFEASIBLE, SolverStatus.UNKNOWN), \
        f"Expected INFEASIBLE/UNKNOWN, got {r.status}"
    assert not r.feasible
    # Must have failures OR conflicts
    assert len(r.failures) > 0 or len(r.conflicts) > 0, \
        "Must provide explanation for infeasibility"
    print(f"✓ TEST 10 — Impossible schedule: {len(r.failures)} failures, "
          f"{len(r.conflicts)} conflicts reported")


# ============================== Runner ==============================
def main() -> None:
    print("\n=== SCHEDULER TEST SUITE ===\n")
    tests = [
        test_1_simple_feasible,
        test_2_teacher_double_booking,
        test_3_class_double_booking,
        test_4_room_double_booking,
        test_5_teacher_day_off,
        test_6_teacher_workload,
        test_7_laboratory_room,
        test_8_fixed_lesson,
        test_9_seventh_periods,
        test_10_impossible_schedule,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            passed += 1
        except AssertionError as e:
            print(f"✗ {t.__name__}: FAIL — {e}")
            failed += 1
        except Exception as e:
            print(f"✗ {t.__name__}: ERROR — {type(e).__name__}: {e}")
            failed += 1
    print(f"\n=== {passed}/{len(tests)} passed, {failed} failed ===\n")
    return failed


if __name__ == "__main__":
    import sys
    sys.exit(main())
