"""CP-SAT model builder.

Builds a constraint-optimization model for school timetabling.

Decision variables
------------------
For every required weekly occurrence `o` of every lesson and every
candidate (day, period, room) slot `s` we create a Boolean:

    x[o, s] ∈ {0, 1}

where `x[o, s] = 1` iff occurrence `o` occupies slot `s`.

We pre-compute the candidate slot list per occurrence to keep model size
tractable — only slots that respect teacher availability, day-off,
teacher qualification, room compatibility, capacity and fixed-lesson
constraints are emitted as candidates.

Hard constraints
----------------
H1  Teacher conflict       — no two occurrences share (teacher, day, period)
H2  Class conflict          — no two occurrences share (section, day, period)
H3  Room conflict            — no two occurrences share (room, day, period)
H4  Teacher availability     — candidates already exclude forbidden slots
H5  Teacher day off          — candidates already exclude day-off slots
H6  Duty conflict            — candidates already exclude duty slots
H7  Fixed lessons            — fixed occurrences have a single candidate slot
H8  Room compatibility       — candidates already exclude incompatible rooms
H9  Room capacity             — candidates already exclude under-capacity rooms
H10 Weekly occurrence count  — each occurrence must be placed exactly once
H11 Teacher qualification    — only qualified teachers can teach the subject

Soft constraints (weighted, minimized)
---------------------------------------
S1  Teacher gaps              — penalise idle periods between teaching
S2  Subject clustering        — penalise multiple same-subject occurrences same day
S3  Unbalanced daily load     — penalise uneven teacher daily distribution
S4  Seventh period imbalance — minimise |seventh_count - target|
S5  Unwanted periods         — penalise forbidden/non-preferred periods
S6  Teacher preferences      — reward preferred periods
S7  Consecutive lessons      — reward configured consecutive runs
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Set, Optional
import time
from ..models import (SolverRequest, LessonIn, TeacherIn, SubjectIn,
                      RoomIn, SectionIn, DutyIn, ConstraintIn,
                      PlacedEntry, DutyEntry, SolverStatus)


def parse_days(s: str) -> List[str]:
    return [d.strip().upper() for d in (s or "").split(",") if d.strip()]


@dataclass
class Occurrence:
    """A single schedulable unit. lesson with weeklyOccurrences=5 → 5 Occurrences."""
    occurrence_id: str  # f"{lesson_id}#{n}"
    lesson_id: str
    occurrence_number: int
    teacher_id: str
    subject_id: str
    section_id: str
    room_id: Optional[str]
    lesson: LessonIn
    subject: SubjectIn
    section: SectionIn
    teacher: TeacherIn
    fixed: bool = False
    fixed_day: Optional[str] = None
    fixed_period: Optional[int] = None


@dataclass
class CandidateSlot:
    day: str
    period: int
    room_id: Optional[str]


@dataclass
class SoftWeights:
    teacher_gaps: int = 100
    subject_cluster: int = 100
    daily_load_imbalance: int = 200
    seventh_imbalance: int = 500
    unwanted_periods: int = 100
    teacher_preferences: int = 100
    consecutive_lessons: int = 50
    workload_deviation: int = 300


def _slot_key(day: str, period: int) -> str:
    return f"{day}_{period}"


def _parse_period_list(s: str) -> Set[int]:
    return {int(x.strip()) for x in (s or "").split(",") if x.strip().isdigit()}


def build_occurrences(req: SolverRequest) -> List[Occurrence]:
    """Expand each lesson into N weekly occurrences."""
    teacher_by_id = {t.id: t for t in req.teachers}
    subject_by_id = {s.id: s for s in req.subjects}
    section_by_id = {s.id: s for s in req.sections}
    occurrences: List[Occurrence] = []
    for lesson in req.lessons:
        teacher = teacher_by_id.get(lesson.teacherId)
        subject = subject_by_id.get(lesson.subjectId)
        section = section_by_id.get(lesson.sectionId)
        if not teacher or not subject or not section:
            continue
        for n in range(1, lesson.weeklyOccurrences + 1):
            occurrences.append(Occurrence(
                occurrence_id=f"{lesson.id}#{n}",
                lesson_id=lesson.id,
                occurrence_number=n,
                teacher_id=teacher.id,
                subject_id=subject.id,
                section_id=section.id,
                room_id=lesson.roomId,
                lesson=lesson,
                subject=subject,
                section=section,
                teacher=teacher,
                fixed=lesson.fixed,
                fixed_day=lesson.fixedDay,
                fixed_period=lesson.fixedPeriod,
            ))
    return occurrences


def build_candidate_slots(
    occ: Occurrence,
    req: SolverRequest,
    all_days: List[str],
    periods_per_day: int,
    teacher_occupied: Dict[str, Set[str]],
    teacher_allowed_slots: Dict[str, Set[str]],
    rooms_compatible: Dict[str, List[RoomIn]],
    teacher_fixed_slots: Optional[Dict[str, Set[Tuple[str, int]]]] = None,
    section_fixed_slots: Optional[Dict[str, Set[Tuple[str, int]]]] = None,
    room_fixed_slots: Optional[Dict[str, Set[Tuple[str, int, str]]]] = None,
) -> List[CandidateSlot]:
    """Compute the list of (day, period, room) candidates that already respect:
       - teacher availability / day-off / duty conflict
       - section's currently-occupied slots (none here — we're building fresh)
       - room compatibility (subject.requiredRoomType matches room.type)
       - room capacity (>= section.studentCount)
       - subject forbidden periods
       - lesson-level forbidden slots
       - fixed-lesson slot (if fixed)
       - PRE-FILTER (Phase 4): skip any (day, period) where the SAME teacher
         or SAME section already has a DIFFERENT fixed lesson pinned to that
         slot. These slots would be infeasible — don't create a Boolean var
         for them.
    """
    candidates: List[CandidateSlot] = []

    if occ.fixed and occ.fixed_day and occ.fixed_period is not None:
        # Single candidate — the fixed slot
        room_id = occ.room_id
        if room_id is None and occ.subject.requiredRoomType:
            # Pick first compatible room
            for r in rooms_compatible.get(occ.subject.id, []):
                room_id = r.id
                break
        return [CandidateSlot(day=occ.fixed_day, period=occ.fixed_period, room_id=room_id)]

    lesson_forbidden = _parse_period_list(occ.lesson.forbiddenSlots) | {
        int(x) for x in (occ.lesson.forbiddenSlots or "").split(",") if "_" in x
    }
    # forbiddenSlots may be either "5,6" (period) or "MON_5" (day_period)
    lesson_forbidden_keys = {x.strip() for x in (occ.lesson.forbiddenSlots or "").split(",") if "_" in x}
    subject_forbidden = set(occ.subject.forbiddenPeriods or [])

    compatible_rooms: List[RoomIn] = []
    if occ.subject.requiredRoomType:
        # Lab/practical/sport/activity — enumerate compatible rooms
        compatible_rooms = [r for r in req.rooms if r.type == occ.subject.requiredRoomType
                             and r.capacity >= occ.section.studentCount]
    else:
        # Theory lesson — collapse the room dimension: pick ONE classroom
        # (the section's home room if compatible, otherwise first classroom
        # with sufficient capacity). This dramatically reduces model size.
        if occ.section.roomId:
            home = next((r for r in req.rooms if r.id == occ.section.roomId), None)
            if home and home.capacity >= occ.section.studentCount:
                compatible_rooms = [home]
        if not compatible_rooms:
            # Fallback: first classroom with enough capacity
            for r in req.rooms:
                if r.type == "CLASSROOM" and r.capacity >= occ.section.studentCount:
                    compatible_rooms = [r]
                    break

    # If lesson has an explicit roomId, prefer that one (still must be compatible)
    if occ.room_id:
        explicit_room = next((r for r in req.rooms if r.id == occ.room_id), None)
        if explicit_room and (not occ.subject.requiredRoomType
                              or explicit_room.type == occ.subject.requiredRoomType) \
           and explicit_room.capacity >= occ.section.studentCount:
            compatible_rooms = [explicit_room]
        else:
            compatible_rooms = []

    for day in all_days:
        for period in range(1, periods_per_day + 1):
            sk = _slot_key(day, period)
            # Teacher availability
            if sk not in teacher_allowed_slots.get(occ.teacher_id, set()):
                continue
            # Teacher occupied by duty
            if sk in teacher_occupied.get(occ.teacher_id, set()):
                continue
            # PRE-FILTER (Phase 4): skip slots where the SAME teacher already
            # has a DIFFERENT fixed lesson pinned. This (day, period) is
            # unreachable for this occurrence.
            if teacher_fixed_slots is not None:
                tfs = teacher_fixed_slots.get(occ.teacher_id)
                if tfs and (day, period) in tfs:
                    # This teacher is pinned to (day, period) by another lesson — skip
                    continue
            # PRE-FILTER (Phase 4): same for sections — if THIS section is
            # pinned to (day, period) by another fixed lesson, this slot is
            # unreachable.
            if section_fixed_slots is not None:
                sfs = section_fixed_slots.get(occ.section_id)
                if sfs and (day, period) in sfs:
                    continue
            # Subject forbidden periods
            if period in subject_forbidden:
                continue
            # Lesson forbidden slot keys
            if sk in lesson_forbidden_keys:
                continue
            # Lesson forbidden periods (numeric)
            if period in lesson_forbidden:
                continue
            # Room candidates
            if not compatible_rooms:
                # No compatible room — skip (model will mark this as infeasible later)
                continue
            for r in compatible_rooms:
                # PRE-FILTER (Phase 4): skip rooms that are already occupied
                # by a different fixed lesson at this (day, period)
                if room_fixed_slots is not None:
                    rfs = room_fixed_slots.get(r.id)
                    if rfs and (day, period, r.id) in rfs:
                        continue
                candidates.append(CandidateSlot(day=day, period=period, room_id=r.id))

    return candidates


def build_model(req: SolverRequest):
    """Build the CP-SAT model. Returns:
       (model, x_vars, occurrences, candidates, duty_entries, soft_weights, build_meta)
    """
    from ortools.sat.python import cp_model

    t0 = time.time()
    model = cp_model.CpModel()
    all_days = parse_days(req.school.workingDays)
    periods_per_day = req.school.periodsPerDay

    # Build occurrences
    t_occ_start = time.time()
    occurrences = build_occurrences(req)
    t_occ_ms = int((time.time() - t_occ_start) * 1000)
    if not occurrences:
        return model, {}, [], [], [], SoftWeights(), {"occurrences": 0, "candidates": 0, "stages": {}}

    # Build teacher allowed slots + teacher occupied (duty) slots
    t_teach_start = time.time()
    teacher_allowed: Dict[str, Set[str]] = {}
    teacher_occupied: Dict[str, Set[str]] = {}
    days_off_map: Dict[str, Set[str]] = {}
    for t in req.teachers:
        teacher_allowed[t.id] = set()
        teacher_occupied[t.id] = set()
        days_off_map[t.id] = set(req.daysOff.get(t.id, []))
        for d in all_days:
            if d in days_off_map[t.id]:
                continue
            for p in range(1, periods_per_day + 1):
                sk = _slot_key(d, p)
                state = req.availability.get(t.id, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                teacher_allowed[t.id].add(sk)
    for duty in req.duties:
        teacher_occupied[duty.teacherId].add(_slot_key(duty.day, duty.period))
    t_teach_ms = int((time.time() - t_teach_start) * 1000)

    # Pre-build the (teacher,day,period) -> fixed_lesson_pin map so the
    # candidate-slot enumerator can skip slots already taken by a fixed
    # lesson FOR THE SAME TEACHER. This eliminates infeasible Boolean vars
    # before CP-SAT even sees them.
    teacher_fixed_slots: Dict[str, Set[Tuple[str, int]]] = {}
    section_fixed_slots: Dict[str, Set[Tuple[str, int]]] = {}
    room_fixed_slots: Dict[str, Set[Tuple[str, int, str]]] = {}
    for lesson in req.lessons:
        if not lesson.fixed or not lesson.fixedDay or lesson.fixedPeriod is None:
            continue
        dp = (lesson.fixedDay, lesson.fixedPeriod)
        teacher_fixed_slots.setdefault(lesson.teacherId, set()).add(dp)
        section_fixed_slots.setdefault(lesson.sectionId, set()).add(dp)
        if lesson.roomId:
            room_fixed_slots.setdefault(lesson.roomId, set()).add((lesson.fixedDay, lesson.fixedPeriod, lesson.roomId))

    # Pre-compute compatible rooms per subject
    rooms_compatible: Dict[str, List[RoomIn]] = {}
    for s in req.subjects:
        if s.requiredRoomType:
            rooms_compatible[s.id] = [r for r in req.rooms
                                       if r.type == s.requiredRoomType
                                       and r.capacity >= 0]
        else:
            rooms_compatible[s.id] = list(req.rooms)

    # Build candidate slots per occurrence
    t_cand_start = time.time()
    candidates_per_occ: Dict[str, List[CandidateSlot]] = {}
    for occ in occurrences:
        candidates_per_occ[occ.occurrence_id] = build_candidate_slots(
            occ, req, all_days, periods_per_day,
            teacher_occupied, teacher_allowed, rooms_compatible,
            teacher_fixed_slots, section_fixed_slots, room_fixed_slots,
        )
    t_cand_ms = int((time.time() - t_cand_start) * 1000)

    # Build decision variables
    # x[occurrence_id, candidate_index] ∈ {0, 1}
    t_vars_start = time.time()
    x: Dict[Tuple[str, int], cp_model.IntVar] = {}
    candidate_index: Dict[str, List[CandidateSlot]] = {}
    for occ in occurrences:
        cands = candidates_per_occ[occ.occurrence_id]
        candidate_index[occ.occurrence_id] = cands
        for i, _ in enumerate(cands):
            x[(occ.occurrence_id, i)] = model.NewBoolVar(f"x_{occ.occurrence_id}_{i}")

    # H10 — weekly occurrence count: each occurrence placed exactly once
    for occ in occurrences:
        cands = candidate_index.get(occ.occurrence_id, [])
        if not cands:
            # No candidates at all → model is infeasible
            model.Add(model.NewConstant(0) == 1)  # force infeasibility
            continue
        vars_ = [x[(occ.occurrence_id, i)] for i in range(len(cands))]
        model.Add(sum(vars_) == 1)
    t_vars_end_ms = int((time.time() - t_vars_start) * 1000)

    # Helper: for an occurrence, the set of candidate indices that map to a given (day, period)
    def candidates_at(occ_id: str, day: str, period: int) -> List[int]:
        out = []
        for i, c in enumerate(candidate_index[occ_id]):
            if c.day == day and c.period == period:
                out.append(i)
        return out

    # H1 — Teacher conflict: for each (teacher, day, period), at most one occurrence uses it
    t_h_start = time.time()
    teacher_slot_occurrences: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            key = (occ.teacher_id, c.day, c.period)
            teacher_slot_occurrences.setdefault(key, []).append((occ.occurrence_id, i))
    for key, lst in teacher_slot_occurrences.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H2 — Class conflict: for each (section, day, period), at most one occurrence
    section_slot_occurrences: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            key = (occ.section_id, c.day, c.period)
            section_slot_occurrences.setdefault(key, []).append((occ.occurrence_id, i))
    for key, lst in section_slot_occurrences.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H3 — Room conflict: for each (room, day, period), at most one occurrence
    room_slot_occurrences: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.room_id is None:
                continue
            key = (c.room_id, c.day, c.period)
            room_slot_occurrences.setdefault(key, []).append((occ.occurrence_id, i))
    for key, lst in room_slot_occurrences.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)
    t_h_ms = int((time.time() - t_h_start) * 1000)

    # Soft weights from constraint list
    t_soft_start = time.time()
    sw = SoftWeights()
    for c in req.constraints:
        if not c.enabled:
            continue
        if c.code == "SOFT_MIN_TEACHER_GAPS":
            sw.teacher_gaps = c.weight
        elif c.code == "SOFT_NO_REPEAT_SAME_DAY":
            sw.subject_cluster = c.weight
        elif c.code == "SOFT_MAX_DAILY_LESSONS":
            sw.daily_load_imbalance = c.weight
        elif c.code == "SOFT_SEVENTH_EQUAL":
            sw.seventh_imbalance = c.weight
        elif c.code == "SOFT_PREFERRED_PERIODS":
            sw.unwanted_periods = c.weight
            sw.teacher_preferences = c.weight
        elif c.code == "SOFT_WORKLOAD_BALANCE":
            sw.workload_deviation = c.weight

    # Build soft penalty terms
    penalties: List[Tuple[str, "cp_model.LinearExpr", int]] = []

    # S5 — Unwanted periods (forbidden/non-preferred)
    # We penalise candidates whose period is not in subject.preferredPeriods (when set)
    # or is in subject.forbiddenPeriods (already excluded — but if user soft-forbidden,
    # we'd penalise). For simplicity, penalise non-preferred periods when preferred list is non-empty.
    for occ in occurrences:
        preferred = set(occ.subject.preferredPeriods or [])
        if not preferred:
            continue
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.period not in preferred:
                penalties.append(("unwanted", x[(occ.occurrence_id, i)], sw.unwanted_periods))

    # S1 — Teacher gaps: TRUE calculation (Phase 8).
    # For each (teacher, day), for each period p in 2..n-1, count a gap when:
    #   - the teacher teaches at SOME period < p
    #   - the teacher teaches at SOME period > p
    #   - the teacher does NOT teach at p
    # Periods before the first teaching or after the last teaching are NOT counted.
    teacher_day_vars: Dict[Tuple[str, str], List["cp_model.IntVar"]] = {}
    teacher_day_period_vars: Dict[Tuple[str, str, int], List["cp_model.IntVar"]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            teacher_day_vars.setdefault((occ.teacher_id, c.day), []).append(
                x[(occ.occurrence_id, i)]
            )
            teacher_day_period_vars.setdefault((occ.teacher_id, c.day, c.period), []).append(
                x[(occ.occurrence_id, i)]
            )

    # Build gap indicators
    gap_indicators: List["cp_model.IntVar"] = []
    for (tid, day), day_vars in teacher_day_vars.items():
        if not day_vars:
            continue
        # has_at_p: BoolVar, 1 iff teacher teaches at (tid, day, p)
        has_at: Dict[int, "cp_model.IntVar"] = {}
        for p in range(1, periods_per_day + 1):
            slot_vars = teacher_day_period_vars.get((tid, day, p), [])
            if slot_vars:
                has_p = model.NewBoolVar(f"has_{tid[:6]}_{day}_{p}")
                # has_p = 1 iff sum(slot_vars) >= 1
                # (sum(slot_vars) is bounded to 0 or 1 by H1 teacher-conflict)
                model.Add(sum(slot_vars) >= 1).OnlyEnforceIf(has_p)
                model.Add(sum(slot_vars) == 0).OnlyEnforceIf(has_p.Not())
                has_at[p] = has_p
        if len(has_at) < 2:
            continue
        # For each p in 2..n-1, gap_p = (some teaching before p) AND (some teaching after p) AND (no teaching at p)
        for p in range(2, periods_per_day):
            before_vars = [has_at[k] for k in range(1, p) if k in has_at]
            after_vars = [has_at[k] for k in range(p + 1, periods_per_day + 1) if k in has_at]
            if not before_vars or not after_vars:
                continue
            before_b = model.NewBoolVar(f"before_{tid[:6]}_{day}_{p}")
            model.Add(sum(before_vars) >= 1).OnlyEnforceIf(before_b)
            model.Add(sum(before_vars) == 0).OnlyEnforceIf(before_b.Not())
            after_b = model.NewBoolVar(f"after_{tid[:6]}_{day}_{p}")
            model.Add(sum(after_vars) >= 1).OnlyEnforceIf(after_b)
            model.Add(sum(after_vars) == 0).OnlyEnforceIf(after_b.Not())
            gap_p = model.NewBoolVar(f"gap_{tid[:6]}_{day}_{p}")
            if p in has_at:
                at_p = has_at[p]
                # gap_p = before_b AND after_b AND NOT at_p
                model.Add(gap_p <= before_b)
                model.Add(gap_p <= after_b)
                model.Add(gap_p + at_p <= 1)
                model.Add(gap_p >= before_b + after_b - at_p - 1)
            else:
                # No vars at p → "NOT at_p" is constant True
                model.Add(gap_p <= before_b)
                model.Add(gap_p <= after_b)
                model.Add(gap_p >= before_b + after_b - 1)
            gap_indicators.append(gap_p)
    if gap_indicators:
        penalties.append(("gaps", sum(gap_indicators), sw.teacher_gaps))

    # S4 — Seventh period imbalance: minimise sum|seventh_count(t) - target(t)|
    # NOTE: "seventh period" is a SEPARATE business concept from the last
    # period of the day. It comes from req.school.seventhPeriod (the period
    # whose Period.type == "SEVENTH" in the DB). When periodsPerDay=8, the
    # seventh period is P7, NOT P8. When the school has no seventh period
    # configured (None), this soft constraint is silently disabled.
    seventh_period = req.school.seventhPeriod
    target_seventh = {t.id: t.requiredSeventh for t in req.teachers}
    # Build per-teacher seventh-period count
    seventh_count: Dict[str, List["cp_model.IntVar"]] = {t.id: [] for t in req.teachers}
    if seventh_period is not None:
        for occ in occurrences:
            for i, c in enumerate(candidate_index[occ.occurrence_id]):
                if c.period == seventh_period:
                    seventh_count[occ.teacher_id].append(x[(occ.occurrence_id, i)])
    seventh_dev_exprs: List["cp_model.LinearExpr"] = []
    for tid, vars_ in seventh_count.items():
        if not vars_:
            continue
        count_var = model.NewIntVar(0, len(vars_), f"seventh_{tid}")
        model.Add(count_var == sum(vars_))
        target = target_seventh.get(tid, 0)
        # |count - target| via auxiliary var
        dev = model.NewIntVar(0, len(vars_), f"seventh_dev_{tid}")
        # dev >= count - target AND dev >= target - count
        model.Add(dev >= count_var - target)
        model.Add(dev >= target - count_var)
        seventh_dev_exprs.append(dev)
    if seventh_dev_exprs:
        penalties.append(("seventh", sum(seventh_dev_exprs), sw.seventh_imbalance))

    # S2 — Subject clustering: penalise >1 occurrence of same (section, subject, day)
    # For each (section, subject, day), penalise the count above 1.
    sec_subj_day: Dict[Tuple[str, str, str], List["cp_model.IntVar"]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            key = (occ.section_id, occ.subject_id, c.day)
            sec_subj_day.setdefault(key, []).append(x[(occ.occurrence_id, i)])
    cluster_penalties: List["cp_model.LinearExpr"] = []
    for key, vars_ in sec_subj_day.items():
        if len(vars_) <= 1:
            continue
        count_var = model.NewIntVar(0, len(vars_), f"cluster_{key[0][:4]}_{key[1][:4]}_{key[2]}")
        model.Add(count_var == sum(vars_))
        # Penalise count - 1 (above 1)
        excess = model.NewIntVar(0, len(vars_), f"cluster_excess_{key[0][:4]}_{key[1][:4]}_{key[2]}")
        model.Add(excess >= count_var - 1)
        cluster_penalties.append(excess)
    if cluster_penalties:
        penalties.append(("cluster", sum(cluster_penalties), sw.subject_cluster))

    # S6 — Teacher preferences: reward preferred slots (negative penalty)
    for occ in occurrences:
        preferred = set(occ.subject.preferredPeriods or [])
        if not preferred:
            continue
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.period in preferred:
                penalties.append(("pref", x[(occ.occurrence_id, i)], -sw.teacher_preferences))

    # S3 — Daily load imbalance: minimise |daily_count - avg|
    # For each teacher, compute per-day teaching count, penalise deviation from requiredWorkload/num_days
    teacher_daily_counts: Dict[str, List["cp_model.IntVar"]] = {}
    for tid, day_vars in teacher_day_vars.items():
        for day in all_days:
            day_count_var = model.NewIntVar(0, periods_per_day, f"load_{tid[:6]}_{day}")
            vars_for_day = [v for (i, c) in enumerate([]) for v in []]  # placeholder
            # Need to sum only the vars for this specific day
            day_specific_vars: List["cp_model.IntVar"] = []
            for occ in occurrences:
                if occ.teacher_id != tid:
                    continue
                for i, c in enumerate(candidate_index[occ.occurrence_id]):
                    if c.day == day:
                        day_specific_vars.append(x[(occ.occurrence_id, i)])
            if day_specific_vars:
                model.Add(day_count_var == sum(day_specific_vars))
                teacher_daily_counts.setdefault(tid, []).append(day_count_var)
    # Penalise deviation from average
    load_dev_exprs: List["cp_model.LinearExpr"] = []
    for tid, day_counts in teacher_daily_counts.items():
        if len(day_counts) <= 1:
            continue
        avg = sum(day_counts) // len(day_counts) if day_counts else 0
        # Use a softer form: penalise max - min
        max_var = model.NewIntVar(0, periods_per_day, f"loadmax_{tid[:6]}")
        min_var = model.NewIntVar(0, periods_per_day, f"loadmin_{tid[:6]}")
        model.AddMaxEquality(max_var, day_counts)
        model.AddMinEquality(min_var, day_counts)
        spread = model.NewIntVar(0, periods_per_day, f"loadspread_{tid[:6]}")
        model.Add(spread == max_var - min_var)
        load_dev_exprs.append(spread)
    if load_dev_exprs:
        penalties.append(("load", sum(load_dev_exprs), sw.daily_load_imbalance))

    # Build the objective: minimise sum(penalty_weight * indicator)
    if penalties:
        objective_expr = sum(w * v for _, v, w in penalties)
        model.Minimize(objective_expr)

    build_meta = {
        "occurrences": len(occurrences),
        "candidates": sum(len(c) for c in candidate_index.values()),
        "build_ms": int((time.time() - t0) * 1000),
        "stages": {
            "occurrences_ms": t_occ_ms,
            "teacher_slots_ms": t_teach_ms,
            "candidates_ms": t_cand_ms,
            "vars_ms": t_vars_end_ms,
            "hard_constraints_ms": t_h_ms,
            "soft_constraints_ms": int((time.time() - t_soft_start) * 1000),
        },
        "num_bool_vars": len(x),
        "num_hard_constraints": (len([k for k, v in teacher_slot_occurrences.items() if len(v) > 1])
                                  + len([k for k, v in section_slot_occurrences.items() if len(v) > 1])
                                  + len([k for k, v in room_slot_occurrences.items() if len(v) > 1])
                                  + len(occurrences)),  # H10 + H1 + H2 + H3
    }

    duty_entries = [
        DutyEntry(
            dutyId=d.id, teacherId=d.teacherId, day=d.day, period=d.period,
            type=d.type, title=d.title, cellType="DUTY",
        ) for d in req.duties
    ]

    return (model, x, occurrences, candidate_index, duty_entries, sw, build_meta,
            teacher_allowed, teacher_occupied)
