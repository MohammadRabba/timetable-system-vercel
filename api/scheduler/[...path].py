"""Vercel Python Function — School Timetable OR-Tools CP-SAT Scheduler.

This is the Vercel-deployable entry point for the scheduler microservice.
It exposes the FastAPI app from `mini-services/scheduler/app/main.py` via
Mangum (ASGI-to-AWS-Lambda adapter).

Routes (all prefixed with /api/scheduler when accessed from the browser):

  GET  /api/scheduler/health      — liveness probe
  POST /api/scheduler/solve        — full CP-SAT solve
  POST /api/scheduler/validate     — independent timetable validation
  POST /api/scheduler/swap         — legacy swap suggestion engine
  POST /api/scheduler/repair       — real local CP-SAT repair (Phase 5+6)

Local dev:
  The mini-services/scheduler/start.sh script runs uvicorn on port 3040.
  This is for the standalone dev workflow (./scripts/dev-setup.sh).
  In production on Vercel, this file replaces that server.

Security:
  Production calls must include the `X-Scheduler-Secret` header matching
  the SCHEDULER_SECRET env var. Calls without it are rejected with 403.
  (Local dev leaves SCHEDULER_SECRET empty to allow unauthenticated calls
  from the acceptance test scripts.)
"""
from __future__ import annotations
import os, sys, json, re
from pathlib import Path

# Make the mini-services/scheduler/app package importable.
# Vercel Python functions run from the project root, so we add the
# scheduler app directory to sys.path.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_SCHEDULER_APP = _PROJECT_ROOT / "mini-services" / "scheduler"
if str(_SCHEDULER_APP) not in sys.path:
    sys.path.insert(0, str(_SCHEDULER_APP))

# Now we can import the FastAPI app
from app.main import app  # noqa: E402
from mangum import Mangum  # noqa: E402


# ===== Security middleware: SCHEDULER_SECRET check =====
_SCHEDULER_SECRET = (os.environ.get("SCHEDULER_SECRET") or "").strip()
_BASE_PATH_PREFIX = "/api/scheduler"  # Vercel catch-all path prefix

def _strip_prefix(path: str) -> str:
    """Strip the /api/scheduler prefix from incoming paths so the FastAPI
    app (which defines routes as /solve, /validate, etc.) sees the right
    path."""
    if path.startswith(_BASE_PATH_PREFIX):
        stripped = path[len(_BASE_PATH_PREFIX):]
        return stripped if stripped.startswith("/") else "/" + stripped
    return path

def _preprocess_event(event: dict) -> dict:
    """Normalize the event before passing to Mangum — strip the path prefix
    so FastAPI sees /solve instead of /api/scheduler/solve."""
    # AWS HTTP API v2 event
    rc = event.get("requestContext") or {}
    http = rc.get("http") or {}
    if "path" in http:
        http["path"] = _strip_prefix(http["path"])
    # Raw path field (varies by event format)
    if "path" in event:
        event["path"] = _strip_prefix(event["path"])
    if "rawPath" in event:
        event["rawPath"] = _strip_prefix(event["rawPath"])
    return event

_inner_handler = Mangum(app, lifespan="off")

if _SCHEDULER_SECRET:
    def handler(event, context=None):
        # Security check: caller must include X-Scheduler-Secret
        headers = event.get("headers") or {}
        # Header keys are typically lowercased
        provided = (headers.get("x-scheduler-secret")
                     or headers.get("X-Scheduler-Secret")
                     or "")
        if provided != _SCHEDULER_SECRET:
            return {
                "statusCode": 403,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({
                    "error": "FORBIDDEN",
                    "message": "Missing or incorrect X-Scheduler-Secret header.",
                }),
            }
        event = _preprocess_event(event)
        return _inner_handler(event, context)
else:
    def handler(event, context=None):
        event = _preprocess_event(event)
        return _inner_handler(event, context)
