"""Pre-solver feasibility analyzer.

Detects capacity problems before CP-SAT starts:
- Teacher workload > available slots
- Class weekly lessons > week slots
- Lab requirements with no compatible room
- Capacity mismatches
- Fixed-lesson conflicts
- Resource contention (e.g., 3 classes need the same teacher at the same fixed slot)
"""
from __future__ import annotations
from typing import Dict, List, Set
from ..models import SolverRequest, FeasibilityFailure


def parse_days(s: str) -> List[str]:
    return [d.strip().upper() for d in (s or "").split(",") if d.strip()]


def analyze(req: SolverRequest) -> List[FeasibilityFailure]:
    failures: List[FeasibilityFailure] = []
    days = parse_days(req.school.workingDays)
    periods_per_day = req.school.periodsPerDay

    # Build teacher allowed slot count
    teacher_allowed_count: Dict[str, int] = {}
    teacher_duty_count: Dict[str, int] = {}
    for t in req.teachers:
        days_off = set(req.daysOff.get(t.id, []))
        allowed = 0
        for d in days:
            if d in days_off:
                continue
            for p in range(1, periods_per_day + 1):
                sk = f"{d}_{p}"
                state = req.availability.get(t.id, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                allowed += 1
        teacher_allowed_count[t.id] = allowed
        teacher_duty_count[t.id] = sum(1 for du in req.duties if du.teacherId == t.id)

    # Per-teacher required teaching
    teacher_required_teaching: Dict[str, int] = {}
    for l in req.lessons:
        teacher_required_teaching[l.teacherId] = (
            teacher_required_teaching.get(l.teacherId, 0) + l.weeklyOccurrences
        )

    for t in req.teachers:
        allowed = teacher_allowed_count[t.id]
        duties = teacher_duty_count[t.id]
        required_teaching = teacher_required_teaching.get(t.id, 0)
        # Required workload includes teaching + duties + seventh target
        total_required = required_teaching + duties + t.requiredSeventh
        if total_required > allowed:
            failures.append(FeasibilityFailure(
                scope="TEACHER",
                entityId=t.id,
                reason=(f"Teacher {t.name} requires {total_required} periods "
                        f"(teaching {required_teaching} + duties {duties} + seventh {t.requiredSeventh}) "
                        f"but only {allowed} valid slots exist."),
                suggestion="Reduce required workload, add availability, or assign lessons to another teacher.",
            ))
        elif required_teaching > allowed:
            failures.append(FeasibilityFailure(
                scope="TEACHER",
                entityId=t.id,
                reason=(f"Teacher {t.name} teaching requirement {required_teaching} "
                        f"exceeds available slots {allowed}."),
                suggestion="Assign some lessons to another qualified teacher.",
            ))

    # Class weekly lessons vs week slots
    section_required: Dict[str, int] = {}
    for l in req.lessons:
        section_required[l.sectionId] = section_required.get(l.sectionId, 0) + l.weeklyOccurrences
    section_by_id = {s.id: s for s in req.sections}
    max_week_slots = len(days) * periods_per_day
    for sid, required in section_required.items():
        sec = section_by_id.get(sid)
        if required > max_week_slots:
            failures.append(FeasibilityFailure(
                scope="CLASS",
                entityId=sid,
                reason=(f"Class {sec.name if sec else sid} requires {required} lessons "
                        f"but only {max_week_slots} slots exist in the week."),
                suggestion="Reduce weekly lesson count or add working periods/days.",
            ))

    # Lab requirements with no compatible room
    for s in req.subjects:
        if s.requiredRoomType:
            has = any(r.type == s.requiredRoomType and
                       r.capacity >= (min(sec.studentCount for sec in req.sections
                                           if any(l.subjectId == s.id for l in req.lessons
                                                  if l.sectionId == sec.id)) or 0)
                       for r in req.rooms)
            if not has:
                # Check more loosely — capacity >= 0
                has_room = any(r.type == s.requiredRoomType for r in req.rooms)
                if not has_room:
                    failures.append(FeasibilityFailure(
                        scope="GLOBAL",
                        reason=(f"Subject {s.name} requires room type {s.requiredRoomType} "
                                f"but no compatible room exists."),
                        suggestion="Add a compatible laboratory/room, or change subject room type requirement.",
                    ))
                else:
                    # Has the type but capacity too low
                    max_cap = max((r.capacity for r in req.rooms
                                   if r.type == s.requiredRoomType), default=0)
                    failures.append(FeasibilityFailure(
                        scope="ROOM",
                        reason=(f"Subject {s.name} requires room type {s.requiredRoomType} "
                                f"but max capacity of compatible rooms is {max_cap}, "
                                f"too low for some sections."),
                        suggestion="Increase room capacity or reduce section student count.",
                    ))

    # Fixed-lesson conflicts: same teacher at same fixed slot
    fixed_buckets: Dict[str, int] = {}
    teacher_by_id = {t.id: t for t in req.teachers}
    for l in req.lessons:
        if l.fixed and l.fixedDay and l.fixedPeriod is not None:
            k = f"{l.teacherId}_{l.fixedDay}_{l.fixedPeriod}"
            fixed_buckets[k] = fixed_buckets.get(k, 0) + 1
            if fixed_buckets[k] > 1:
                teacher = teacher_by_id.get(l.teacherId)
                failures.append(FeasibilityFailure(
                    scope="TEACHER",
                    entityId=l.teacherId,
                    reason=(f"Teacher {teacher.name if teacher else l.teacherId} has "
                            f"{fixed_buckets[k]} fixed lessons at {l.fixedDay} P{l.fixedPeriod}."),
                    suggestion="Move or unfix conflicting fixed lessons.",
                ))

    # Capacity mismatch for explicitly assigned rooms
    section_students = {s.id: s.studentCount for s in req.sections}
    for l in req.lessons:
        if not l.roomId:
            continue
        room = next((r for r in req.rooms if r.id == l.roomId), None)
        if not room:
            continue
        students = section_students.get(l.sectionId, 0)
        if room.capacity < students:
            failures.append(FeasibilityFailure(
                scope="ROOM",
                entityId=l.roomId,
                reason=(f"Lesson in section {l.sectionId} ({students} students) "
                        f"assigned to room {room.name} (capacity {room.capacity})."),
                suggestion="Assign a room with greater capacity.",
            ))

    return failures
