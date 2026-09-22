"""Top-level solve driver — builds the model, runs CP-SAT, extracts the
solution, validates it independently, and returns a SolverResponse.
"""
from __future__ import annotations
import time
import os
import tracemalloc
from typing import Dict, List, Tuple, Optional
from ..models import (SolverRequest, SolverResponse, SolverStatus,
                       PlacedEntry, DutyEntry, SolverStats, FeasibilityFailure,
                       ValidationIssue, ValidateRequest, ValidateResponse)
from .model import (build_model, build_occurrences, CandidateSlot,
                     SoftWeights, Occurrence, parse_days)
from .conflict_analyzer import analyze as pre_analyze
from .validator import validate as independent_validate


def _slot_key(day: str, period: int) -> str:
    return f"{day}_{period}"


def solve(req: SolverRequest) -> SolverResponse:
    t_start = time.time()
    tracemalloc.start()
    failures: List[FeasibilityFailure] = pre_analyze(req)

    # Pre-flight: hard infeasibility from the analyzer means we can short-circuit
    # but still allow the model to attempt (some "failures" are warnings only).
    blocking = [f for f in failures if "exceeds available slots" in f.reason
                or "but only" in f.reason]
    # We still attempt to solve — pre-analyzer is conservative; the solver
    # may find a feasible solution even with warnings.

    # Build model
    model_result = build_model(req)
    (model, x_vars, occurrences, candidate_index, duty_entries,
     soft_weights, build_meta, teacher_allowed, teacher_occupied) = model_result

    if build_meta["occurrences"] == 0:
        tracemalloc.stop()
        return SolverResponse(
            status=SolverStatus.INFEASIBLE,
            feasible=False, partial=False,
            entries=[], dutyEntries=[],
            stats=SolverStats(requiredOccurrences=0, scheduledOccurrences=0,
                              unscheduledOccurrences=0, teacherConflicts=0,
                              classConflicts=0, roomConflicts=0,
                              availabilityViolations=0, dutyConflicts=0,
                              fixedLessonViolations=0, capacityViolations=0,
                              teacherGaps=0, seventhDeviation=0,
                              subjectCluster=0, workloadDeviation=0,
                              unwantedSlots=0),
            softPenalty=0, qualityScore=0, objectiveValue=None,
            modelGenerationMs=build_meta["build_ms"],
            solverMs=0, wallMs=int((time.time() - t_start) * 1000),
            memoryMb=0, failures=failures, conflicts=[], suggestions=[],
        )

    # Configure solver
    from ortools.sat.python import cp_model
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = req.config.timeLimitSeconds
    solver.parameters.num_workers = req.config.numWorkers
    # log_search_workers not available in this OR-Tools version

    t_solve_start = time.time()
    status = solver.Solve(model)
    solver_ms = int((time.time() - t_solve_start) * 1000)

    # Map CP-SAT status to our SolverStatus
    status_map = {
        cp_model.OPTIMAL: SolverStatus.OPTIMAL,
        cp_model.FEASIBLE: SolverStatus.FEASIBLE,
        cp_model.INFEASIBLE: SolverStatus.INFEASIBLE,
        cp_model.UNKNOWN: SolverStatus.UNKNOWN,
        cp_model.MODEL_INVALID: SolverStatus.MODEL_INVALID,
    }
    solver_status = status_map.get(status, SolverStatus.UNKNOWN)

    # Extract solution
    t_extract_start = time.time()
    entries: List[PlacedEntry] = []
    if solver_status in (SolverStatus.OPTIMAL, SolverStatus.FEASIBLE):
        for occ in occurrences:
            cands = candidate_index.get(occ.occurrence_id, [])
            placed = False
            for i, c in enumerate(cands):
                v = x_vars.get((occ.occurrence_id, i))
                if v is None:
                    continue
                if solver.Value(v) == 1:
                    entries.append(PlacedEntry(
                        occurrenceId=occ.occurrence_id,
                        lessonId=occ.lesson_id,
                        occurrenceNumber=occ.occurrence_number,
                        teacherId=occ.teacher_id,
                        subjectId=occ.subject_id,
                        sectionId=occ.section_id,
                        roomId=c.room_id,
                        day=c.day,
                        period=c.period,
                        cellType="TEACHING",
                        fixed=occ.fixed,
                        locked=occ.lesson.locked,
                    ))
                    placed = True
                    break
            if not placed and req.config.allowPartial:
                # Skip — partial solution allowed
                pass
    t_extract_ms = int((time.time() - t_extract_start) * 1000)

    # Independent validation of the produced timetable
    t_val_start = time.time()
    val_req = ValidateRequest(
        school=req.school,
        teachers=req.teachers,
        sections=req.sections,
        subjects=req.subjects,
        rooms=req.rooms,
        lessons=req.lessons,
        duties=req.duties,
        availability=req.availability,
        daysOff=req.daysOff,
        entries=entries,
        dutyEntries=duty_entries,
    )
    val_result: ValidateResponse = independent_validate(val_req)
    t_val_ms = int((time.time() - t_val_start) * 1000)
    stats = val_result.stats
    conflicts = val_result.issues

    # Profile / debug metadata — exposed as a separate top-level field in the
    # SolverResponse so the acceptance suite can read stage timings.
    profile = {
        "stages": dict(build_meta.get("stages", {})),
        "extraction_ms": t_extract_ms,
        "validation_ms": t_val_ms,
        "pre_analyze_ms": int((time.time() - t_start) * 1000) - build_meta["build_ms"]
                          - solver_ms - t_extract_ms - t_val_ms,
        "occurrences": build_meta["occurrences"],
        "candidates": build_meta["candidates"],
        "num_bool_vars": build_meta.get("num_bool_vars", 0),
        "num_hard_constraints": build_meta.get("num_hard_constraints", 0),
    }

    # Compute soft penalty
    soft_penalty = (stats.teacherGaps * soft_weights.teacher_gaps
                     + stats.subjectCluster * soft_weights.subject_cluster
                     + stats.seventhDeviation * soft_weights.seventh_imbalance
                     + stats.unwantedSlots * soft_weights.unwanted_periods
                     + stats.workloadDeviation * soft_weights.workload_deviation)

    # Quality score 0..100
    required_total = stats.requiredOccurrences
    scheduled_total = stats.scheduledOccurrences
    placement_ratio = (scheduled_total / required_total) if required_total else 1.0
    hard_violations = val_result.hardViolations
    hard_penalty = min(60, hard_violations * 10)
    soft_penalty_norm = min(40, soft_penalty // 100)
    quality_score = max(0, int(100 - hard_penalty - soft_penalty_norm))
    # Boost slightly based on solver status
    if solver_status == SolverStatus.OPTIMAL:
        quality_score = max(quality_score, 80)
    elif solver_status == SolverStatus.FEASIBLE and hard_violations == 0 and scheduled_total == required_total:
        quality_score = max(quality_score, 70)

    # Feasibility decision — STRICT
    feasible = (scheduled_total == required_total and hard_violations == 0)
    partial = (req.config.allowPartial and not feasible
                and scheduled_total > 0
                and scheduled_total < required_total
                and hard_violations == 0)

    # Suggestions
    suggestions: List[str] = []
    if stats.unscheduledOccurrences > 0:
        suggestions.append(
            f"{stats.unscheduledOccurrences} of {required_total} required occurrences "
            "could not be scheduled. Increase teacher availability, reduce weekly "
            "occurrences, or assign more qualified teachers."
        )
    if stats.teacherConflicts > 0:
        suggestions.append("Resolve teacher double-booking — usually caused by locked/fixed lessons.")
    if stats.seventhDeviation > 0:
        suggestions.append(
            f"Seventh-period deviation is {stats.seventhDeviation}. "
            "Adjust teacher requiredSeventh targets."
        )
    if stats.workloadDeviation > 10:
        suggestions.append(
            f"Teacher workload deviation is {stats.workloadDeviation}. "
            "Reassign lessons to balance load."
        )
    if stats.availabilityViolations > 0:
        suggestions.append("Some lessons are in forbidden/unavailable slots — fix availability settings.")
    if stats.capacityViolations > 0:
        suggestions.append("Some rooms are too small for the assigned sections.")

    # Memory
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    memory_mb = int(peak / 1024 / 1024)

    wall_ms = int((time.time() - t_start) * 1000)
    objective_value = int(solver.ObjectiveValue()) if solver_status in (SolverStatus.OPTIMAL, SolverStatus.FEASIBLE) else None

    return SolverResponse(
        status=solver_status,
        feasible=feasible,
        partial=partial,
        entries=entries,
        dutyEntries=duty_entries,
        stats=stats,
        softPenalty=soft_penalty,
        qualityScore=quality_score,
        objectiveValue=objective_value,
        modelGenerationMs=build_meta["build_ms"],
        solverMs=solver_ms,
        wallMs=wall_ms,
        memoryMb=memory_mb,
        failures=failures,
        conflicts=conflicts,
        suggestions=suggestions,
        profile=profile,
    )
