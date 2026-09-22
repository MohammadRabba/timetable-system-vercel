"""Independent validator.

Validates a complete timetable from scratch — never assumes the solver is
correct. Returns a full validation report with hard + soft violations and
stats matching the SolverStats schema.
"""
from __future__ import annotations
from typing import Dict, List, Set, Tuple
from ..models import (ValidateRequest, ValidateResponse, PlacedEntry,
                       DutyEntry, ValidationIssue, SolverStats,
                       FeasibilityFailure)
import re


def parse_days(s: str) -> List[str]:
    return [d.strip().upper() for d in (s or "").split(",") if d.strip()]


def _slot_key(day: str, period: int) -> str:
    return f"{day}_{period}"


def validate(req: ValidateRequest) -> ValidateResponse:
    """Validate the given timetable from scratch."""
    issues: List[ValidationIssue] = []
    teacher_by_id = {t.id: t for t in req.teachers}
    subject_by_id = {s.id: s for s in req.subjects}
    section_by_id = {s.id: s for s in req.sections}
    room_by_id = {r.id: r for r in req.rooms}
    lesson_by_id = {l.id: l for l in req.lessons}

    all_days = parse_days(req.school.workingDays)
    periods_per_day = req.school.periodsPerDay
    # "Seventh period" is a SEPARATE business concept from the last period
    # of the day. It is driven by req.school.seventhPeriod (set by the
    # input-builder from Period.type == "SEVENTH" in the DB), NOT by
    # periods_per_day. With periodsPerDay=8, the seventh period is P7, not P8.
    seventh_period = req.school.seventhPeriod

    # 1. Weekly occurrence count — every required occurrence scheduled exactly once
    required_per_lesson = {l.id: l.weeklyOccurrences for l in req.lessons}
    scheduled_per_lesson: Dict[str, int] = {l.id: 0 for l in req.lessons}
    for e in req.entries:
        if e.lessonId in scheduled_per_lesson:
            scheduled_per_lesson[e.lessonId] += 1
    for lesson_id, required in required_per_lesson.items():
        actual = scheduled_per_lesson.get(lesson_id, 0)
        if actual < required:
            lesson = lesson_by_id.get(lesson_id)
            issues.append(ValidationIssue(
                type="WEEKLY_OCCURRENCE",
                severity="CRITICAL",
                message=f"Lesson {lesson_id} ({lesson.subjectId if lesson else ''}) "
                        f"requires {required} weekly occurrences but only {actual} scheduled.",
                entityIds=[lesson_id],
            ))
        elif actual > required:
            issues.append(ValidationIssue(
                type="WEEKLY_OCCURRENCE",
                severity="CRITICAL",
                message=f"Lesson {lesson_id} scheduled {actual} times but requires only {required}.",
                entityIds=[lesson_id],
            ))

    # 2. Teacher conflict
    teacher_slot: Dict[Tuple[str, str, int], List[PlacedEntry]] = {}
    for e in req.entries:
        key = (e.teacherId, e.day, e.period)
        teacher_slot.setdefault(key, []).append(e)
    for (tid, day, period), lst in teacher_slot.items():
        if len(lst) > 1:
            teacher = teacher_by_id.get(tid)
            issues.append(ValidationIssue(
                type="TEACHER",
                severity="CRITICAL",
                day=day, period=period,
                message=f"Teacher {teacher.name if teacher else tid} double-booked at {day} period {period}.",
                entityIds=[e.lessonId for e in lst if e.lessonId],
            ))

    # 3. Class conflict
    section_slot: Dict[Tuple[str, str, int], List[PlacedEntry]] = {}
    for e in req.entries:
        key = (e.sectionId, e.day, e.period)
        section_slot.setdefault(key, []).append(e)
    for (sid, day, period), lst in section_slot.items():
        if len(lst) > 1:
            sec = section_by_id.get(sid)
            issues.append(ValidationIssue(
                type="CLASS",
                severity="CRITICAL",
                day=day, period=period,
                message=f"Section {sec.name if sec else sid} has {len(lst)} lessons at {day} period {period}.",
                entityIds=[e.lessonId for e in lst if e.lessonId],
            ))

    # 4. Room conflict
    room_slot: Dict[Tuple[str, str, int], List[PlacedEntry]] = {}
    for e in req.entries:
        if not e.roomId:
            continue
        key = (e.roomId, e.day, e.period)
        room_slot.setdefault(key, []).append(e)
    for (rid, day, period), lst in room_slot.items():
        if len(lst) > 1:
            room = room_by_id.get(rid)
            issues.append(ValidationIssue(
                type="ROOM",
                severity="CRITICAL",
                day=day, period=period,
                message=f"Room {room.name if room else rid} double-booked at {day} period {period}.",
                entityIds=[e.lessonId for e in lst if e.lessonId],
            ))

    # 5. Teacher availability (forbidden periods)
    for e in req.entries:
        sk = _slot_key(e.day, e.period)
        state = req.availability.get(e.teacherId, {}).get(sk)
        if state in ("UNAVAILABLE", "FORBIDDEN"):
            teacher = teacher_by_id.get(e.teacherId)
            issues.append(ValidationIssue(
                type="AVAILABILITY",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Teacher {teacher.name if teacher else e.teacherId} "
                        f"scheduled at {e.day} P{e.period} but marked {state}.",
                entityIds=[e.lessonId] if e.lessonId else [],
            ))

    # 6. Teacher day off
    for e in req.entries:
        if e.day in req.daysOff.get(e.teacherId, []):
            teacher = teacher_by_id.get(e.teacherId)
            issues.append(ValidationIssue(
                type="DAY_OFF",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Teacher {teacher.name if teacher else e.teacherId} "
                        f"scheduled on day-off {e.day}.",
                entityIds=[e.lessonId] if e.lessonId else [],
            ))

    # 7. Duty conflict — teacher cannot teach during duty
    duty_slots: Dict[Tuple[str, str, int], DutyEntry] = {}
    for d in req.dutyEntries:
        duty_slots[(d.teacherId, d.day, d.period)] = d
    for e in req.entries:
        key = (e.teacherId, e.day, e.period)
        if key in duty_slots:
            issues.append(ValidationIssue(
                type="DUTY",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Teacher has duty at {e.day} P{e.period} but also scheduled to teach.",
                entityIds=[e.lessonId] if e.lessonId else [],
            ))

    # 8. Room compatibility (lab/practical)
    for e in req.entries:
        if not e.subjectId or not e.roomId:
            continue
        subject = subject_by_id.get(e.subjectId)
        room = room_by_id.get(e.roomId)
        if subject and subject.requiredRoomType and room and room.type != subject.requiredRoomType:
            issues.append(ValidationIssue(
                type="ROOM_COMPATIBILITY",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Subject {subject.name} requires {subject.requiredRoomType} "
                        f"but assigned to {room.name} ({room.type}).",
                entityIds=[e.lessonId] if e.lessonId else [],
            ))

    # 9. Capacity
    for e in req.entries:
        if not e.roomId or not e.sectionId:
            continue
        room = room_by_id.get(e.roomId)
        section = section_by_id.get(e.sectionId)
        if room and section and room.capacity < section.studentCount:
            issues.append(ValidationIssue(
                type="CAPACITY",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Room {room.name} (cap {room.capacity}) < section {section.name} ({section.studentCount}).",
                entityIds=[e.lessonId] if e.lessonId else [],
            ))

    # 10. Fixed lessons — must be at their fixed slot
    for e in req.entries:
        if not e.lessonId:
            continue
        lesson = lesson_by_id.get(e.lessonId)
        if not lesson or not lesson.fixed:
            continue
        if lesson.fixedDay and e.day != lesson.fixedDay:
            issues.append(ValidationIssue(
                type="FIXED",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Fixed lesson moved from {lesson.fixedDay} to {e.day}.",
                entityIds=[e.lessonId],
            ))
        if lesson.fixedPeriod is not None and e.period != lesson.fixedPeriod:
            issues.append(ValidationIssue(
                type="FIXED",
                severity="CRITICAL",
                day=e.day, period=e.period,
                message=f"Fixed lesson moved from P{lesson.fixedPeriod} to P{e.period}.",
                entityIds=[e.lessonId],
            ))

    # Compute stats
    required_total = sum(l.weeklyOccurrences for l in req.lessons)
    scheduled_total = len(req.entries)
    teacher_conflicts = sum(1 for v in teacher_slot.values() if len(v) > 1)
    class_conflicts = sum(1 for v in section_slot.values() if len(v) > 1)
    room_conflicts = sum(1 for v in room_slot.values() if len(v) > 1)
    availability_violations = sum(1 for i in issues if i.type == "AVAILABILITY")
    day_off_violations = sum(1 for i in issues if i.type == "DAY_OFF")
    duty_conflicts = sum(1 for i in issues if i.type == "DUTY")
    fixed_violations = sum(1 for i in issues if i.type == "FIXED")
    capacity_violations = sum(1 for i in issues if i.type == "CAPACITY")
    room_compat_violations = sum(1 for i in issues if i.type == "ROOM_COMPATIBILITY")
    weekly_violations = sum(1 for i in issues if i.type == "WEEKLY_OCCURRENCE")

    # Teacher gaps
    teacher_gaps = 0
    for t in req.teachers:
        for day in all_days:
            periods = sorted({e.period for e in req.entries
                              if e.teacherId == t.id and e.day == day})
            periods.extend([d.period for d in req.dutyEntries
                            if d.teacherId == t.id and d.day == day])
            periods = sorted(set(periods))
            for i in range(1, len(periods)):
                gap = periods[i] - periods[i-1] - 1
                if gap > 0:
                    teacher_gaps += gap

    # Seventh deviation (only when seventhPeriod is configured)
    seventh_deviation = 0
    if seventh_period is not None:
        seventh_counts = {t.id: 0 for t in req.teachers}
        for e in req.entries:
            if e.period == seventh_period and e.teacherId in seventh_counts:
                seventh_counts[e.teacherId] += 1
        target_seventh = sum(t.requiredSeventh for t in req.teachers) / max(1, len(req.teachers))
        seventh_deviation = int(sum(abs(c - target_seventh) for c in seventh_counts.values()))

    # Subject clustering
    cluster_counts: Dict[Tuple[str, str, str], int] = {}
    for e in req.entries:
        key = (e.sectionId, e.subjectId, e.day)
        cluster_counts[key] = cluster_counts.get(key, 0) + 1
    subject_cluster = sum(v - 1 for v in cluster_counts.values() if v > 1)

    # Workload deviation
    workload = {t.id: 0 for t in req.teachers}
    for e in req.entries:
        if e.teacherId in workload:
            workload[e.teacherId] += 1
    for d in req.dutyEntries:
        if d.teacherId in workload:
            workload[d.teacherId] += 1
    avg_wl = sum(workload.values()) / max(1, len(workload))
    workload_deviation = int(sum(abs(v - avg_wl) for v in workload.values()))

    # Unwanted periods
    unwanted = 0
    for e in req.entries:
        if not e.subjectId:
            continue
        subject = subject_by_id.get(e.subjectId)
        if not subject:
            continue
        forbidden = set(subject.forbiddenPeriods or [])
        preferred = set(subject.preferredPeriods or [])
        if e.period in forbidden:
            unwanted += 1
        elif preferred and e.period not in preferred:
            unwanted += 1

    hard_violations = (teacher_conflicts + class_conflicts + room_conflicts
                        + availability_violations + day_off_violations
                        + duty_conflicts + fixed_violations + capacity_violations
                        + room_compat_violations + weekly_violations)

    stats = SolverStats(
        requiredOccurrences=required_total,
        scheduledOccurrences=scheduled_total,
        unscheduledOccurrences=max(0, required_total - scheduled_total),
        teacherConflicts=teacher_conflicts,
        classConflicts=class_conflicts,
        roomConflicts=room_conflicts,
        availabilityViolations=availability_violations,
        dutyConflicts=duty_conflicts,
        fixedLessonViolations=fixed_violations,
        capacityViolations=capacity_violations + room_compat_violations,
        teacherGaps=teacher_gaps,
        seventhDeviation=seventh_deviation,
        subjectCluster=subject_cluster,
        workloadDeviation=workload_deviation,
        unwantedSlots=unwanted,
    )
    valid = (hard_violations == 0 and scheduled_total == required_total)

    return ValidateResponse(
        valid=valid,
        hardViolations=hard_violations,
        softPenalty=teacher_gaps + subject_cluster + unwanted + seventh_deviation,
        issues=issues,
        stats=stats,
    )
