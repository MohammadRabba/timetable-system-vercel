"""Direct Python service test — builds a small request and posts to the scheduler."""
import json
import sys
import urllib.request
sys.path.insert(0, "/home/z/my-project/mini-services/scheduler")
from app.models import SolverRequest
from app.solver import solve
from app.solver.driver import solve as driver_solve

# Build a simple request
req = {
    "school": {"id": "S1", "name": "Test", "workingDays": "SUN,MON,TUE,WED,THU", "periodsPerDay": 7},
    "teachers": [
        {"id": "T1", "name": "Alice", "requiredWorkload": 5, "maxDailyPeriods": 7, "minDailyPeriods": 0, "requiredSeventh": 0, "maxSeventh": 3},
        {"id": "T2", "name": "Bob", "requiredWorkload": 5, "maxDailyPeriods": 7, "minDailyPeriods": 0, "requiredSeventh": 0, "maxSeventh": 3},
    ],
    "sections": [{"id": "C1", "name": "10-A", "studentCount": 20, "roomId": None}],
    "subjects": [
        {"id": "MATH", "name": "Math", "type": "THEORY", "defaultWeekly": 3, "maxPerDay": 2, "minGap": 0, "consecutive": False, "preferredPeriods": [], "forbiddenPeriods": [], "requiredRoomType": None, "priority": 100},
        {"id": "EN", "name": "English", "type": "THEORY", "defaultWeekly": 2, "maxPerDay": 2, "minGap": 0, "consecutive": False, "preferredPeriods": [], "forbiddenPeriods": [], "requiredRoomType": None, "priority": 100},
    ],
    "rooms": [{"id": "R1", "name": "Room A", "type": "CLASSROOM", "capacity": 30}],
    "lessons": [
        {"id": "L1", "teacherId": "T1", "subjectId": "MATH", "sectionId": "C1", "roomId": None, "weeklyOccurrences": 3, "duration": 1, "lessonType": "THEORY", "priority": 100, "requiredConsecutive": 0, "preferredSlots": "", "forbiddenSlots": "", "fixed": False, "fixedDay": None, "fixedPeriod": None, "locked": False, "coTeacherId": None},
        {"id": "L2", "teacherId": "T2", "subjectId": "EN", "sectionId": "C1", "roomId": None, "weeklyOccurrences": 2, "duration": 1, "lessonType": "THEORY", "priority": 100, "requiredConsecutive": 0, "preferredSlots": "", "forbiddenSlots": "", "fixed": False, "fixedDay": None, "fixedPeriod": None, "locked": False, "coTeacherId": None},
    ],
    "duties": [],
    "availability": {},
    "daysOff": {},
    "constraints": [],
    "config": {"timeLimitSeconds": 10, "numWorkers": 2, "profile": "FAST", "allowPartial": True},
}

# Post to scheduler
data = json.dumps(req).encode()
r = urllib.request.Request("http://127.0.0.1:3040/solve",
                            data=data,
                            headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(r, timeout=60)
result = json.loads(resp.read())
print("Status:", result["status"])
print("Feasible:", result["feasible"])
print("Scheduled:", result["stats"]["scheduledOccurrences"], "/", result["stats"]["requiredOccurrences"])
print("Quality:", result["qualityScore"])
print(f"Timing: model={result['modelGenerationMs']}ms, solver={result['solverMs']}ms, wall={result['wallMs']}ms")
