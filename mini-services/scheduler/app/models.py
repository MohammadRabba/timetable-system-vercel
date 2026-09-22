"""Pydantic models for the scheduling microservice API.

A *lesson* is a (teacher, subject, section, room?, weeklyOccurrences) tuple.
A *weekly occurrence* is a single schedulable unit — e.g. a lesson requiring
5 periods/week produces 5 occurrences. The solver treats each occurrence as
an independent decision variable.
"""
from __future__ import annotations
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class DayCode(str, Enum):
    SAT = "SAT"
    SUN = "SUN"
    MON = "MON"
    TUE = "TUE"
    WED = "WED"
    THU = "THU"
    FRI = "FRI"


class AvailabilityState(str, Enum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    PREFERRED = "PREFERRED"
    FORBIDDEN = "FORBIDDEN"


class SchoolIn(BaseModel):
    id: str
    name: str
    workingDays: str  # comma-separated
    periodsPerDay: int
    # The "Seventh Period" is a SEPARATE business concept from the last
    # period of the day. It is the period whose `Period.type == "SEVENTH"`
    # in the database (typically period 7 by convention, but decoupled from
    # `periodsPerDay`). When a school has fewer than 7 periods/day, there
    # is no seventh period and this field is None — the soft-seventh-equal
    # objective is then disabled. When periodsPerDay=8, the seventh period
    # is P7 (second-to-last), NOT the last period (P8).
    seventhPeriod: Optional[int] = None


class TeacherIn(BaseModel):
    id: str
    name: str
    requiredWorkload: int = 24
    maxDailyPeriods: int = 7
    minDailyPeriods: int = 0
    requiredSeventh: int = 0
    maxSeventh: int = 3


class SectionIn(BaseModel):
    id: str
    name: str
    studentCount: int = 0
    roomId: Optional[str] = None


class SubjectIn(BaseModel):
    id: str
    name: str
    type: str = "THEORY"
    defaultWeekly: int = 0
    maxPerDay: int = 2
    minGap: int = 0
    consecutive: bool = False
    preferredPeriods: List[int] = Field(default_factory=list)
    forbiddenPeriods: List[int] = Field(default_factory=list)
    requiredRoomType: Optional[str] = None
    priority: int = 100


class RoomIn(BaseModel):
    id: str
    name: str
    type: str = "CLASSROOM"
    capacity: int = 30


class LessonIn(BaseModel):
    id: str
    teacherId: str
    subjectId: str
    sectionId: str
    roomId: Optional[str] = None
    weeklyOccurrences: int = 1
    duration: int = 1
    lessonType: str = "THEORY"
    priority: int = 100
    requiredConsecutive: int = 0
    preferredSlots: str = ""
    forbiddenSlots: str = ""
    fixed: bool = False
    fixedDay: Optional[str] = None
    fixedPeriod: Optional[int] = None
    locked: bool = False
    coTeacherId: Optional[str] = None


class DutyIn(BaseModel):
    id: str
    teacherId: str
    type: str = "DUTY"
    title: str
    day: str
    period: int
    location: Optional[str] = None


class ConstraintIn(BaseModel):
    code: str
    type: str  # "HARD" | "SOFT"
    weight: int = 1000000
    enabled: bool = True


class SolverProfile(str, Enum):
    FAST = "FAST"
    BALANCED = "BALANCED"
    DEEP = "DEEP"


class SolverConfig(BaseModel):
    timeLimitSeconds: int = 60
    numWorkers: int = 8
    optimizationLevel: int = 2  # 0..3 (CP-SAT hash_seed/log_search_workers combo)
    profile: SolverProfile = SolverProfile.BALANCED
    allowPartial: bool = False  # if True, solver may return PARTIAL when no feasible complete solution


class SolverRequest(BaseModel):
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]  # teacherId -> "DAY_PERIOD" -> state
    daysOff: Dict[str, List[str]]  # teacherId -> [day, ...]
    constraints: List[ConstraintIn]
    config: SolverConfig = Field(default_factory=SolverConfig)


class PlacedEntry(BaseModel):
    occurrenceId: str  # "lessonId#n" — unique per occurrence
    lessonId: str
    occurrenceNumber: int  # 1..N
    teacherId: str
    subjectId: str
    sectionId: str
    roomId: Optional[str] = None
    day: str
    period: int
    cellType: str = "TEACHING"
    fixed: bool = False
    locked: bool = False


class DutyEntry(BaseModel):
    dutyId: str
    teacherId: str
    day: str
    period: int
    type: str
    title: str
    cellType: str = "DUTY"


class SolverStatus(str, Enum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    UNKNOWN = "UNKNOWN"
    MODEL_INVALID = "MODEL_INVALID"


class ValidationIssue(BaseModel):
    type: str
    severity: str  # "CRITICAL" | "WARNING" | "OPTIMIZATION"
    day: Optional[str] = None
    period: Optional[int] = None
    message: str
    entityIds: List[str] = Field(default_factory=list)


class FeasibilityFailure(BaseModel):
    scope: str  # "TEACHER" | "CLASS" | "ROOM" | "GLOBAL"
    entityId: Optional[str] = None
    reason: str
    suggestion: str


class SolverStats(BaseModel):
    requiredOccurrences: int
    scheduledOccurrences: int
    unscheduledOccurrences: int
    teacherConflicts: int
    classConflicts: int
    roomConflicts: int
    availabilityViolations: int
    dutyConflicts: int
    fixedLessonViolations: int
    capacityViolations: int
    teacherGaps: int
    seventhDeviation: int
    subjectCluster: int
    workloadDeviation: int
    unwantedSlots: int


class SolverResponse(BaseModel):
    status: SolverStatus
    feasible: bool  # True iff required == scheduled AND hardViolations == 0
    partial: bool  # True iff status == FEASIBLE but unscheduled > 0 (only when allowPartial)
    entries: List[PlacedEntry]
    dutyEntries: List[DutyEntry]
    stats: SolverStats
    softPenalty: int
    qualityScore: int  # 0..100
    objectiveValue: Optional[int] = None
    modelGenerationMs: int
    solverMs: int
    wallMs: int
    memoryMb: Optional[int] = None
    failures: List[FeasibilityFailure]
    conflicts: List[ValidationIssue]
    suggestions: List[str]
    # Stage-by-stage profiling — populated by the driver. Each field is a
    # millisecond count for one stage of the solve pipeline.
    profile: Optional[Dict[str, Any]] = None


class ValidateRequest(BaseModel):
    """Independent validator request — takes a *full* timetable snapshot
    plus the requirement set and validates from scratch."""
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]
    daysOff: Dict[str, List[str]]
    entries: List[PlacedEntry]  # the timetable to validate
    dutyEntries: List[DutyEntry] = Field(default_factory=list)


class ValidateResponse(BaseModel):
    valid: bool
    hardViolations: int
    softPenalty: int
    issues: List[ValidationIssue]
    stats: SolverStats


class SwapSuggestion(BaseModel):
    day: str
    period: int
    swapWithLessonId: Optional[str] = None
    swapWithOccurrenceId: Optional[str] = None
    reason: str
    hardViolations: int
    softPenalty: int


class SwapRequest(BaseModel):
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]
    daysOff: Dict[str, List[str]]
    entries: List[PlacedEntry]  # current timetable
    targetOccurrenceId: str
    targetDay: str
    targetPeriod: int


class SwapResponse(BaseModel):
    suggestions: List[SwapSuggestion]


class RepairRequest(BaseModel):
    """Local CP-SAT repair request — re-solves only the neighborhood around
    a single moved lesson, preserving all hard constraints and minimizing
    the number of additional moves (Phase 5 + 6)."""
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]
    daysOff: Dict[str, List[str]]
    entries: List[PlacedEntry]  # current (persisted) timetable
    movedOccurrenceId: str      # the occurrence the user just dragged
    newDay: str                 # target day (string form: "MON","TUE",...)
    newPeriod: int              # target period (1-based)
    newRoomId: Optional[str] = None  # target room (None = keep lesson's room)
    repairRadius: int = 2      # neighborhood radius (1=direct conflicts,
                                # 2=conflicts-of-conflicts, etc.)
    config: SolverConfig = Field(default_factory=SolverConfig)


class RepairChange(BaseModel):
    """One lesson's movement in a repair proposal."""
    occurrenceId: str
    lessonId: str
    fromDay: Optional[str] = None
    fromPeriod: Optional[int] = None
    fromRoomId: Optional[str] = None
    toDay: str
    toPeriod: int
    toRoomId: Optional[str] = None
    reason: str = ""    # human-readable: "direct user move" / "vacated target slot" / etc.


class RepairResponse(BaseModel):
    status: SolverStatus
    feasible: bool
    entries: List[PlacedEntry]      # the FULL repaired timetable
    changes: List[RepairChange]    # the diff (what actually moved)
    stats: SolverStats
    conflicts: List[ValidationIssue]
    repaired: bool
    numMovedLessons: int           # explicit count of changed lessons
    message: str
    profile: Optional[Dict[str, Any]] = None
