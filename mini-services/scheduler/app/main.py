"""FastAPI entry point for the scheduling microservice.

Endpoints
---------
POST /health              — liveness probe
POST /solve               — full solve
POST /validate             — independent timetable validation
POST /swap                 — swap suggestion engine (legacy)
POST /repair               — REAL local CP-SAT repair (Phase 5 + 6)

The service is **stateless**: every request includes the full solver input
and the response is fully self-contained. The Next.js backend remains the
source of truth for persistence — this service only computes results.

Run with:
    uvicorn app.main:app --port 3040 --reload
"""
from __future__ import annotations
import logging
from fastapi import FastAPI, HTTPException
from .models import (SolverRequest, SolverResponse, ValidateRequest,
                      ValidateResponse, SwapRequest, SwapResponse,
                      RepairRequest, RepairResponse)
from .solver import solve, validate, find_swaps, repair

logger = logging.getLogger("scheduler")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

app = FastAPI(title="School Timetable CP-SAT Solver", version="1.0.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "scheduler", "engine": "ortools-cp-sat"}


@app.post("/solve", response_model=SolverResponse)
def post_solve(req: SolverRequest) -> SolverResponse:
    try:
        return solve(req)
    except Exception as e:
        logger.exception("solver failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/validate", response_model=ValidateResponse)
def post_validate(req: ValidateRequest) -> ValidateResponse:
    try:
        return validate(req)
    except Exception as e:
        logger.exception("validator failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/swap", response_model=SwapResponse)
def post_swap(req: SwapRequest) -> SwapResponse:
    try:
        return find_swaps(req)
    except Exception as e:
        logger.exception("swap failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/repair", response_model=RepairResponse)
def post_repair(req: RepairRequest) -> RepairResponse:
    """Local repair — re-solves a NEIGHBORHOOD around a moved lesson using
    real CP-SAT (Phase 5 + 6). Freezes all unaffected lessons, allows the
    affected ones to move, minimizes the number of moves * 10000 + soft
    penalties. Returns the FULL repaired timetable + a list of changes
    for the UI to show BEFORE committing."""
    try:
        return repair(req)
    except Exception as e:
        logger.exception("repair failed")
        raise HTTPException(status_code=500, detail=str(e))
