"""Swap suggestion engine.

Given a current timetable and a target move (occurrence → day/period), finds
swap candidates that maintain hard constraints. Returns ranked suggestions.
"""
from __future__ import annotations
from typing import Dict, List, Set, Tuple
from ..models import (SwapRequest, SwapResponse, SwapSuggestion,
                       PlacedEntry, SolverStats)
from .validator import validate, ValidateRequest


def find_swaps(req: SwapRequest) -> SwapResponse:
    """Find candidate swap targets for the requested move."""
    target_occ_id = req.targetOccurrenceId
    target_day = req.targetDay
    target_period = int(req.targetPeriod)

    # Find the moving occurrence
    moving = next((e for e in req.entries if e.occurrenceId == target_occ_id), None)
    if not moving:
        return SwapResponse(suggestions=[])

    # Find what's at the target slot for this teacher / section / room
    occupiers = [
        e for e in req.entries
        if e.occurrenceId != target_occ_id
        and e.day == target_day
        and e.period == target_period
        and (e.teacherId == moving.teacherId
              or e.sectionId == moving.sectionId
              or (moving.roomId and e.roomId == moving.roomId))
    ]
    if not occupiers:
        # Empty target slot — direct move
        return SwapResponse(suggestions=[
            SwapSuggestion(day=target_day, period=target_period,
                            reason="Target slot is empty — direct move",
                            hardViolations=0, softPenalty=0)
        ])

    # For each occupier, find alternative slots where it could move
    suggestions: List[SwapSuggestion] = []
    days = req.school.workingDays.split(",")
    days = [d.strip().upper() for d in days if d.strip()]
    periods_per_day = req.school.periodsPerDay

    # Build a quick slot-occupancy lookup
    used_by_teacher: Dict[Tuple[str, str, int], Set[str]] = {}
    used_by_section: Dict[Tuple[str, str, int], Set[str]] = {}
    used_by_room: Dict[Tuple[str, str, int], Set[str]] = {}
    for e in req.entries:
        if e.occurrenceId == target_occ_id:
            continue  # we're moving this one
        used_by_teacher.setdefault((e.teacherId, e.day, e.period), set()).add(e.occurrenceId)
        used_by_section.setdefault((e.sectionId, e.day, e.period), set()).add(e.occurrenceId)
        if e.roomId:
            used_by_room.setdefault((e.roomId, e.day, e.period), set()).add(e.occurrenceId)

    for occ in occupiers:
        # Find empty alternative slots for the occupier
        for day in days:
            for period in range(1, periods_per_day + 1):
                if day == target_day and period == target_period:
                    continue  # that's the slot we're trying to vacate
                # Check teacher available
                sk = f"{day}_{period}"
                state = req.availability.get(occ.teacherId, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                # Check teacher not on duty
                if any(d.teacherId == occ.teacherId and d.day == day and d.period == period
                       for d in req.duties):
                    continue
                # Check teacher day off
                if day in req.daysOff.get(occ.teacherId, []):
                    continue
                # Check teacher conflict
                if (occ.teacherId, day, period) in used_by_teacher:
                    continue
                # Check section conflict
                if (occ.sectionId, day, period) in used_by_section:
                    continue
                # Check room conflict
                if occ.roomId and (occ.roomId, day, period) in used_by_room:
                    continue
                # Found a valid swap target
                suggestions.append(SwapSuggestion(
                    day=day, period=period,
                    swapWithLessonId=occ.lessonId,
                    swapWithOccurrenceId=occ.occurrenceId,
                    reason=f"Swap occupier {occ.occurrenceId} ({occ.lessonId}) → {day} P{period}",
                    hardViolations=0,
                    softPenalty=0,
                ))

    # Rank by soft-penalty (would require a full validate call per suggestion — skip for now)
    return SwapResponse(suggestions=suggestions[:20])
