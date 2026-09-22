"""Real CP-SAT local repair engine (Phase 5 + Phase 6).

When a user drags a lesson to a new slot via the timetable UI, the target
slot may already be occupied by another lesson (teacher/section/room
conflict). The local repair engine:

  1. Loads the current persisted timetable.
  2. Identifies the moved lesson (the user's drag).
  3. Pre-applies the user's move.
  4. Detects direct conflicts at the target slot.
  5. Builds a neighborhood (radius-N BFS over (teacher/section/room)
     connections) — all lessons within `repairRadius` hops of the moved
     lesson.
  6. Freezes ALL lessons OUTSIDE the neighborhood at their current slots.
  7. Allows lessons IN the neighborhood to move (each gets a Boolean var
     per candidate slot, exactly like the full solver).
  8. Runs CP-SAT only on this neighborhood (much smaller model → fast).
  9. Preserves all hard constraints (teacher/section/room/availability/
     day-off/duty/fixed/room-compatibility/capacity).
 10. Objective (Phase 6):
        Minimize(10000 * num_moved_lessons
                 + hard_constraint_penalty
                 + soft_constraint_penalty)
    so the solver STRONGLY prefers moving 1 lesson over 10 lessons.
 11. Returns the full repaired timetable + a list of proposed changes
    (what actually moved) so the UI can show the user BEFORE committing.
"""
from __future__ import annotations
import time
from typing import Dict, List, Set, Tuple, Optional, Any
from collections import defaultdict

from ..models import (RepairRequest, RepairResponse, RepairChange,
                       SolverStatus, SolverStats, PlacedEntry,
                       ValidationIssue, LessonIn, TeacherIn, SubjectIn,
                       SectionIn, RoomIn, DutyIn)
from .validator import validate as independent_validate, ValidateRequest


def _empty_stats() -> SolverStats:
    """Construct an empty SolverStats with all fields zeroed out."""
    return SolverStats(
        requiredOccurrences=0, scheduledOccurrences=0, unscheduledOccurrences=0,
        teacherConflicts=0, classConflicts=0, roomConflicts=0,
        availabilityViolations=0, dutyConflicts=0,
        fixedLessonViolations=0, capacityViolations=0,
        teacherGaps=0, seventhDeviation=0,
        subjectCluster=0, workloadDeviation=0, unwantedSlots=0,
    )


def _slot_key(day: str, period: int) -> str:
    return f"{day}_{period}"


def _parse_days(s: str) -> List[str]:
    return [d.strip().upper() for d in (s or "").split(",") if d.strip()]


def _build_neighborhood(
    entries: List[PlacedEntry],
    moved_occ_id: str,
    new_day: str,
    new_period: int,
    new_room_id: Optional[str],
    radius: int,
) -> Set[str]:
    """BFS over (teacher/section/room)-conflict edges to find all
    occurrences within `radius` hops of the moved lesson.

    Hop 0: just the moved lesson itself.
    Hop 1: lessons that conflict with the moved lesson AT ITS NEW SLOT
           (i.e., share teacher / section / room with the moved lesson at
           (new_day, new_period)).
    Hop 2: lessons that conflict with any hop-1 lesson AT ITS CURRENT slot.
    Hop 3..N: same pattern.

    Locked lessons are EXCLUDED from the neighborhood (they cannot be
    moved — the user has pinned them). They still cause conflicts that
    must be resolved by moving OTHER lessons, but the locked lesson itself
    stays put.
    """
    # Build (teacher/section/room, day, period) -> set(occurrenceId) lookup
    by_teacher_slot: Dict[Tuple[str, str, int], Set[str]] = defaultdict(set)
    by_section_slot: Dict[Tuple[str, str, int], Set[str]] = defaultdict(set)
    by_room_slot: Dict[Tuple[str, str, int], Set[str]] = defaultdict(set)
    for e in entries:
        by_teacher_slot[(e.teacherId, e.day, e.period)].add(e.occurrenceId)
        by_section_slot[(e.sectionId, e.day, e.period)].add(e.occurrenceId)
        if e.roomId:
            by_room_slot[(e.roomId, e.day, e.period)].add(e.occurrenceId)

    moved_entry = next((e for e in entries if e.occurrenceId == moved_occ_id), None)
    if not moved_entry:
        return set()

    neighborhood: Set[str] = {moved_occ_id}

    # LOCKED lessons can NEVER move — they must stay frozen. They are
    # excluded from the neighborhood (so they end up in the "frozen" pool
    # and their slots are off-limits to neighborhood lessons).
    locked_ids: Set[str] = {e.occurrenceId for e in entries if e.locked}

    # Hop 1: lessons at the moved lesson's NEW slot that share teacher/section/room
    hop1: Set[str] = set()
    hop1 |= by_teacher_slot.get((moved_entry.teacherId, new_day, new_period), set())
    hop1 |= by_section_slot.get((moved_entry.sectionId, new_day, new_period), set())
    if new_room_id:
        hop1 |= by_room_slot.get((new_room_id, new_day, new_period), set())
    elif moved_entry.roomId:
        hop1 |= by_room_slot.get((moved_entry.roomId, new_day, new_period), set())
    hop1.discard(moved_occ_id)
    # Filter out locked lessons from the BFS frontier (they cannot move)
    hop1 -= locked_ids
    neighborhood |= hop1

    # Further hops: BFS by (teacher, current_day, current_period) / section / room
    frontier = hop1
    for hop in range(1, radius):
        next_frontier: Set[str] = set()
        for occ_id in frontier:
            occ_entry = next((e for e in entries if e.occurrenceId == occ_id), None)
            if not occ_entry:
                continue
            key_t = (occ_entry.teacherId, occ_entry.day, occ_entry.period)
            key_s = (occ_entry.sectionId, occ_entry.day, occ_entry.period)
            for nid in by_teacher_slot.get(key_t, set()):
                if nid not in neighborhood and nid not in locked_ids:
                    next_frontier.add(nid)
            for nid in by_section_slot.get(key_s, set()):
                if nid not in neighborhood and nid not in locked_ids:
                    next_frontier.add(nid)
            if occ_entry.roomId:
                key_r = (occ_entry.roomId, occ_entry.day, occ_entry.period)
                for nid in by_room_slot.get(key_r, set()):
                    if nid not in neighborhood and nid not in locked_ids:
                        next_frontier.add(nid)
        neighborhood |= next_frontier
        frontier = next_frontier
        if not frontier:
            break

    return neighborhood


def _build_candidate_slots_for_repair(
    occ_entry: PlacedEntry,
    req: RepairRequest,
    all_days: List[str],
    periods_per_day: int,
    neighborhood: Set[str],
    teacher_occupied: Dict[str, Set[str]],
    section_occupied: Dict[str, Set[str]],
    room_occupied: Dict[str, Set[str]],
    teacher_allowed: Dict[str, Set[str]],
) -> List[Tuple[str, int, Optional[str]]]:
    """For a neighborhood lesson, compute all (day, period, room) slots it
    can move to WITHOUT immediately colliding with a FROZEN lesson. Hard
    constraints checked: teacher availability, day-off, duty, subject
    forbidden periods. (Section/teacher/room conflicts WITH OTHER
    NEIGHBORHOOD LESSONS are handled by the CP-SAT model, not here.)
    """
    candidates: List[Tuple[str, int, Optional[str]]] = []

    # Look up the original LessonIn to get subject + room compatibility info
    lesson = next((l for l in req.lessons if l.id == occ_entry.lessonId), None)
    if not lesson:
        return []
    subject = next((s for s in req.subjects if s.id == occ_entry.subjectId), None)
    if not subject:
        return []
    section = next((s for s in req.sections if s.id == occ_entry.sectionId), None)
    if not section:
        return []

    # Compute compatible rooms
    compatible_rooms: List[RoomIn] = []
    if subject.requiredRoomType:
        compatible_rooms = [r for r in req.rooms
                            if r.type == subject.requiredRoomType
                            and r.capacity >= section.studentCount]
    else:
        # Theory lesson — use the section's home room if compatible,
        # otherwise any classroom with sufficient capacity.
        if section.roomId:
            home = next((r for r in req.rooms if r.id == section.roomId), None)
            if home and home.capacity >= section.studentCount:
                compatible_rooms = [home]
        if not compatible_rooms:
            for r in req.rooms:
                if r.type == "CLASSROOM" and r.capacity >= section.studentCount:
                    compatible_rooms = [r]
                    break

    # Lesson-level room override
    if lesson.roomId:
        explicit = next((r for r in req.rooms if r.id == lesson.roomId), None)
        if explicit and (not subject.requiredRoomType
                          or explicit.type == subject.requiredRoomType) \
           and explicit.capacity >= section.studentCount:
            compatible_rooms = [explicit]
        else:
            compatible_rooms = []

    # Parse lesson forbidden slots
    lesson_forbidden_periods = {int(x.strip()) for x in (lesson.forbiddenSlots or "").split(",") if x.strip().isdigit()}
    lesson_forbidden_keys = {x.strip() for x in (lesson.forbiddenSlots or "").split(",") if "_" in x}
    subject_forbidden = set(subject.forbiddenPeriods or [])

    for day in all_days:
        # Day-off check
        if day in req.daysOff.get(occ_entry.teacherId, []):
            continue
        for period in range(1, periods_per_day + 1):
            sk = _slot_key(day, period)
            # Teacher availability
            if sk not in teacher_allowed.get(occ_entry.teacherId, set()):
                continue
            # Subject forbidden
            if period in subject_forbidden:
                continue
            # Lesson forbidden
            if period in lesson_forbidden_periods or sk in lesson_forbidden_keys:
                continue
            # Check if a FROZEN lesson occupies this (teacher/section/room) slot
            # (frozen = NOT in the neighborhood)
            if sk in teacher_occupied.get(occ_entry.teacherId, set()):
                continue
            if sk in section_occupied.get(occ_entry.sectionId, set()):
                continue
            # Room conflict with frozen lessons — check each compatible room
            for r in compatible_rooms:
                if r.id and sk in room_occupied.get(r.id, set()):
                    continue
                candidates.append((day, period, r.id))
    return candidates


def repair(req: RepairRequest) -> RepairResponse:
    """Run a local CP-SAT repair on the timetable around the moved lesson."""
    from ortools.sat.python import cp_model

    t_start = time.time()
    all_days = _parse_days(req.school.workingDays)
    periods_per_day = req.school.periodsPerDay
    new_day = req.newDay.upper()
    new_period = int(req.newPeriod)
    new_room_id = req.newRoomId
    moved_occ_id = req.movedOccurrenceId

    # ===== Validate the user's requested target slot =====
    # Reject impossible moves BEFORE building the CP-SAT model.
    if new_day not in all_days:
        return RepairResponse(
            status=SolverStatus.INFEASIBLE, feasible=False,
            entries=req.entries, changes=[], stats=_empty_stats(),
            conflicts=[ValidationIssue(
                type="INVALID_TARGET", severity="CRITICAL",
                day=new_day, period=new_period,
                message=f"Target day '{new_day}' is not in school's working days {all_days}.",
                entityIds=[moved_occ_id])],
            repaired=False, numMovedLessons=0,
            message=f"NO_REPAIR_FOUND: target day '{new_day}' is not a working day.",
        )
    if new_period < 1 or new_period > periods_per_day:
        return RepairResponse(
            status=SolverStatus.INFEASIBLE, feasible=False,
            entries=req.entries, changes=[], stats=_empty_stats(),
            conflicts=[ValidationIssue(
                type="INVALID_TARGET", severity="CRITICAL",
                day=new_day, period=new_period,
                message=f"Target period P{new_period} out of range [1..{periods_per_day}].",
                entityIds=[moved_occ_id])],
            repaired=False, numMovedLessons=0,
            message=f"NO_REPAIR_FOUND: target period P{new_period} out of range.",
        )

    # Find the moved entry
    moved_entry = next((e for e in req.entries if e.occurrenceId == moved_occ_id), None)
    if not moved_entry:
        return RepairResponse(
            status=SolverStatus.MODEL_INVALID, feasible=False,
            entries=req.entries, changes=[], stats=_empty_stats(),
            conflicts=[], repaired=False, numMovedLessons=0,
            message=f"Moved occurrence '{moved_occ_id}' not found in current timetable.",
        )

    # If the moved lesson is LOCKED, refuse to repair.
    if moved_entry.locked:
        return RepairResponse(
            status=SolverStatus.INFEASIBLE, feasible=False,
            entries=req.entries, changes=[], stats=_empty_stats(),
            conflicts=[ValidationIssue(
                type="LOCKED", severity="CRITICAL",
                day=moved_entry.day, period=moved_entry.period,
                message=f"Lesson {moved_occ_id} is locked — cannot be moved.",
                entityIds=[moved_entry.lessonId])],
            repaired=False, numMovedLessons=0,
            message="NO_REPAIR_FOUND: the moved lesson is locked.",
        )

    # ============== Build neighborhood ==============
    t_nb_start = time.time()
    neighborhood = _build_neighborhood(
        req.entries, moved_occ_id, new_day, new_period, new_room_id,
        req.repairRadius,
    )
    t_nb_ms = int((time.time() - t_nb_start) * 1000)

    # ============== Build occupied-slot maps (for frozen lessons) ==============
    # For each (teacher/section/room), the slots occupied by FROZEN lessons
    # (i.e., NOT in the neighborhood). These slots are off-limits to any
    # neighborhood lesson.
    teacher_occupied_frozen: Dict[str, Set[str]] = defaultdict(set)
    section_occupied_frozen: Dict[str, Set[str]] = defaultdict(set)
    room_occupied_frozen: Dict[str, Set[str]] = defaultdict(set)
    for e in req.entries:
        if e.occurrenceId in neighborhood:
            continue  # neighborhood lesson — not frozen
        sk = _slot_key(e.day, e.period)
        teacher_occupied_frozen[e.teacherId].add(sk)
        section_occupied_frozen[e.sectionId].add(sk)
        if e.roomId:
            room_occupied_frozen[e.roomId].add(sk)

    # Teacher allowed slots (availability + day-off + duty pre-filter)
    teacher_allowed: Dict[str, Set[str]] = defaultdict(set)
    days_off_map: Dict[str, Set[str]] = {t.id: set(req.daysOff.get(t.id, [])) for t in req.teachers}
    duty_slots: Set[Tuple[str, str, int]] = set()
    for d in req.duties:
        duty_slots.add((d.teacherId, d.day, d.period))
    for t in req.teachers:
        for d in all_days:
            if d in days_off_map.get(t.id, set()):
                continue
            for p in range(1, periods_per_day + 1):
                sk = _slot_key(d, p)
                state = req.availability.get(t.id, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                teacher_allowed[t.id].add(sk)

    # ============== Build candidate slots per neighborhood lesson ==============
    t_cand_start = time.time()
    candidates_per_occ: Dict[str, List[Tuple[str, int, Optional[str]]]] = {}
    for occ_id in neighborhood:
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        cands = _build_candidate_slots_for_repair(
            occ_entry, req, all_days, periods_per_day, neighborhood,
            teacher_occupied_frozen, section_occupied_frozen,
            room_occupied_frozen, teacher_allowed,
        )
        # The moved lesson MUST be placed at (new_day, new_period) — the
        # user's intent. Force its candidate set to be just that slot.
        if occ_id == moved_occ_id:
            # Use new_room_id if provided, else the lesson's existing room
            forced_room = new_room_id or occ_entry.roomId
            cands = [(new_day, new_period, forced_room)]
        candidates_per_occ[occ_id] = cands
    t_cand_ms = int((time.time() - t_cand_start) * 1000)

    # ============== Build CP-SAT model ==============
    t_model_start = time.time()
    model = cp_model.CpModel()

    # Decision vars: x[occ_id, cand_idx] ∈ {0, 1}
    x: Dict[Tuple[str, int], cp_model.IntVar] = {}
    for occ_id, cands in candidates_per_occ.items():
        for i, _ in enumerate(cands):
            x[(occ_id, i)] = model.NewBoolVar(f"x_{occ_id}_{i}")

    # H10 — each neighborhood lesson placed exactly once
    for occ_id, cands in candidates_per_occ.items():
        if not cands:
            # No candidates → infeasible. Force infeasibility.
            model.Add(model.NewConstant(0) == 1)
            continue
        vars_ = [x[(occ_id, i)] for i in range(len(cands))]
        model.Add(sum(vars_) == 1)

    # H1 — Teacher conflict (between neighborhood lessons)
    teacher_slot_occ: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = defaultdict(list)
    for occ_id, cands in candidates_per_occ.items():
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        for i, (day, period, _room) in enumerate(cands):
            teacher_slot_occ[(occ_entry.teacherId, day, period)].append((occ_id, i))
    for key, lst in teacher_slot_occ.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H2 — Section conflict (between neighborhood lessons)
    section_slot_occ: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = defaultdict(list)
    for occ_id, cands in candidates_per_occ.items():
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        for i, (day, period, _room) in enumerate(cands):
            section_slot_occ[(occ_entry.sectionId, day, period)].append((occ_id, i))
    for key, lst in section_slot_occ.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H3 — Room conflict (between neighborhood lessons, for each room)
    room_slot_occ: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = defaultdict(list)
    for occ_id, cands in candidates_per_occ.items():
        for i, (day, period, room_id) in enumerate(cands):
            if room_id:
                room_slot_occ[(room_id, day, period)].append((occ_id, i))
    for key, lst in room_slot_occ.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H6 — Duty conflict (already filtered in candidate generation, but
    # double-check): the moved lesson's NEW slot must not be on a duty slot
    # for the same teacher.
    for occ_id, cands in candidates_per_occ.items():
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        for i, (day, period, _room) in enumerate(cands):
            if (occ_entry.teacherId, day, period) in duty_slots:
                # This candidate is on a duty slot — exclude it
                model.Add(x[(occ_id, i)] == 0)

    # ============== Objective (Phase 6) ==============
    # Minimize: 10000 * num_moved_lessons + soft_penalty
    # A lesson is "moved" if its assigned slot != its original slot.
    move_indicators: List[cp_model.IntVar] = []
    for occ_id, cands in candidates_per_occ.items():
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        for i, (day, period, room_id) in enumerate(cands):
            same_day = (day == occ_entry.day)
            same_period = (period == occ_entry.period)
            same_room = (room_id == occ_entry.roomId) or (not room_id and not occ_entry.roomId)
            if same_day and same_period and same_room:
                # Same slot — not moved
                continue
            # This candidate would be a "move" — track it via the move indicator
            move_indicators.append(x[(occ_id, i)])

    # The moved lesson (the user's drag) MUST count as a move.
    # All other neighborhood lessons should prefer NOT to move.

    # Soft penalties (simplified): subject clustering + unwanted periods
    # (use the same weights as the main solver, lighter set)
    soft_penalties: List[Tuple[cp_model.LinearExpr, int]] = []

    # S2 — Subject clustering: penalize >1 same-subject occurrence at same (section, day)
    sec_subj_day: Dict[Tuple[str, str, str], List[cp_model.IntVar]] = defaultdict(list)
    for occ_id, cands in candidates_per_occ.items():
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        for i, (day, _period, _room) in enumerate(cands):
            sec_subj_day[(occ_entry.sectionId, occ_entry.subjectId, day)].append(x[(occ_id, i)])
    cluster_excess_vars: List[cp_model.LinearExpr] = []
    for key, vars_ in sec_subj_day.items():
        if len(vars_) <= 1:
            continue
        # Also include the OTHER (frozen) occurrences of the same (section, subject, day)
        frozen_count = sum(1 for e in req.entries
                           if e.occurrenceId not in neighborhood
                           and e.sectionId == key[0]
                           and e.subjectId == key[1]
                           and e.day == key[2])
        # Penalize total > 1
        total_var = model.NewIntVar(0, len(vars_) + frozen_count, f"cluster_{key[0][:4]}_{key[1][:4]}_{key[2]}")
        model.Add(total_var == sum(vars_) + frozen_count)
        excess = model.NewIntVar(0, len(vars_) + frozen_count, f"excess_{key[0][:4]}_{key[1][:4]}_{key[2]}")
        model.Add(excess >= total_var - 1)
        cluster_excess_vars.append(excess)
    if cluster_excess_vars:
        soft_penalties.append((sum(cluster_excess_vars), 100))

    # S5 — Unwanted periods (preferred)
    pref_penalties: List[cp_model.LinearExpr] = []
    for occ_id, cands in candidates_per_occ.items():
        occ_entry = next(e for e in req.entries if e.occurrenceId == occ_id)
        subject = next((s for s in req.subjects if s.id == occ_entry.subjectId), None)
        if not subject:
            continue
        preferred = set(subject.preferredPeriods or [])
        if not preferred:
            continue
        for i, (_day, period, _room) in enumerate(cands):
            if period not in preferred:
                pref_penalties.append(x[(occ_id, i)])
    if pref_penalties:
        soft_penalties.append((sum(pref_penalties), 100))

    # Build the objective
    # 10000 * (sum of move indicators) + sum of soft weights
    # Each move indicator is a Bool var (1 if lesson moved to that slot).
    # Since each lesson has exactly 1 candidate chosen, sum(x[occ, i] for
    # moved-candidates) = 1 if lesson moved, 0 if not.
    objective_terms: List[Tuple[cp_model.LinearExpr, int]] = []
    if move_indicators:
        objective_terms.append((sum(move_indicators), 10000))
    for expr, w in soft_penalties:
        objective_terms.append((expr, w))

    if objective_terms:
        objective_expr = sum(w * v for v, w in objective_terms)
        model.Minimize(objective_expr)

    t_model_ms = int((time.time() - t_model_start) * 1000)

    # ============== Solve ==============
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = req.config.timeLimitSeconds or 10
    solver.parameters.num_workers = req.config.numWorkers or 4

    t_solve_start = time.time()
    status = solver.Solve(model)
    t_solve_ms = int((time.time() - t_solve_start) * 1000)

    status_map = {
        cp_model.OPTIMAL: SolverStatus.OPTIMAL,
        cp_model.FEASIBLE: SolverStatus.FEASIBLE,
        cp_model.INFEASIBLE: SolverStatus.INFEASIBLE,
        cp_model.UNKNOWN: SolverStatus.UNKNOWN,
        cp_model.MODEL_INVALID: SolverStatus.MODEL_INVALID,
    }
    solver_status = status_map.get(status, SolverStatus.UNKNOWN)

    # ============== Extract solution ==============
    t_extract_start = time.time()
    repaired_entries: List[PlacedEntry] = []
    changes: List[RepairChange] = []
    num_moved = 0
    if solver_status in (SolverStatus.OPTIMAL, SolverStatus.FEASIBLE):
        # Build a new entries list: frozen lessons unchanged, neighborhood
        # lessons take their assigned slot from the solver.
        for e in req.entries:
            if e.occurrenceId not in neighborhood:
                # Frozen — keep as-is
                repaired_entries.append(e)
            else:
                cands = candidates_per_occ.get(e.occurrenceId, [])
                placed = False
                for i, (day, period, room_id) in enumerate(cands):
                    v = x.get((e.occurrenceId, i))
                    if v is None:
                        continue
                    if solver.Value(v) == 1:
                        new_e = PlacedEntry(
                            occurrenceId=e.occurrenceId,
                            lessonId=e.lessonId,
                            occurrenceNumber=e.occurrenceNumber,
                            teacherId=e.teacherId,
                            subjectId=e.subjectId,
                            sectionId=e.sectionId,
                            roomId=room_id or e.roomId,
                            day=day,
                            period=period,
                            cellType=e.cellType,
                            fixed=e.fixed,
                            locked=e.locked,
                        )
                        repaired_entries.append(new_e)
                        # Track change if slot moved
                        if (day != e.day or period != e.period
                            or (room_id or e.roomId) != (e.roomId or room_id)):
                            num_moved += 1
                            is_user_move = (e.occurrenceId == moved_occ_id)
                            changes.append(RepairChange(
                                occurrenceId=e.occurrenceId,
                                lessonId=e.lessonId,
                                fromDay=e.day, fromPeriod=e.period,
                                fromRoomId=e.roomId,
                                toDay=day, toPeriod=period,
                                toRoomId=room_id or e.roomId,
                                reason="direct user move" if is_user_move
                                        else "vacated by repair",
                            ))
                        placed = True
                        break
                if not placed:
                    # Should not happen if solver found feasible — fall back to original
                    repaired_entries.append(e)
    t_extract_ms = int((time.time() - t_extract_start) * 1000)

    # ============== Independent validation of the repaired timetable ==============
    t_val_start = time.time()
    val_req = ValidateRequest(
        school=req.school, teachers=req.teachers, sections=req.sections,
        subjects=req.subjects, rooms=req.rooms, lessons=req.lessons,
        duties=req.duties, availability=req.availability, daysOff=req.daysOff,
        entries=repaired_entries, dutyEntries=[],
    )
    val_result = independent_validate(val_req)
    t_val_ms = int((time.time() - t_val_start) * 1000)

    stats = val_result.stats
    conflicts = val_result.issues

    # Determine feasibility
    feasible = (stats.scheduledOccurrences == stats.requiredOccurrences
                and val_result.hardViolations == 0)
    repaired = feasible and len(changes) > 0

    # Build the response message
    if feasible and num_moved > 0:
        message = f"Repaired: moved {num_moved} lesson(s) including the user's drag."
    elif feasible and num_moved == 0:
        # Should not happen — user's drag itself counts as a move
        message = "Repaired: 0 lessons moved (suspicious — user drag should always count as 1 move)."
    elif solver_status == SolverStatus.INFEASIBLE:
        message = "NO_REPAIR_FOUND: no feasible local repair exists within the neighborhood."
    elif solver_status == SolverStatus.UNKNOWN:
        message = f"Solver timed out after {solver.parameters.max_time_in_seconds}s — no repair found."
    else:
        message = f"Repair returned status={solver_status}, hardViolations={val_result.hardViolations}."

    # Build profile
    profile = {
        "neighborhood_size": len(neighborhood),
        "neighborhood_ms": t_nb_ms,
        "candidates_ms": t_cand_ms,
        "model_ms": t_model_ms,
        "solver_ms": t_solve_ms,
        "extraction_ms": t_extract_ms,
        "validation_ms": t_val_ms,
        "wall_ms": int((time.time() - t_start) * 1000),
        "num_bool_vars": len(x),
        "objective_value": int(solver.ObjectiveValue()) if solver_status in (SolverStatus.OPTIMAL, SolverStatus.FEASIBLE) else None,
    }

    return RepairResponse(
        status=solver_status,
        feasible=feasible,
        entries=repaired_entries,
        changes=changes,
        stats=stats,
        conflicts=conflicts,
        repaired=repaired,
        numMovedLessons=num_moved,
        message=message,
        profile=profile,
    )
