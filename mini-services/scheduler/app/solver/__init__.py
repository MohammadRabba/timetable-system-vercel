"""Solver package — exposes solve(), validate(), find_swaps(), repair()."""
from .driver import solve
from .validator import validate
from .conflict_analyzer import analyze
from .repair import find_swaps
from .local_repair import repair

__all__ = ["solve", "validate", "analyze", "find_swaps", "repair"]
