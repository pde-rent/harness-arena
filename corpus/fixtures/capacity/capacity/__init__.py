"""Metrics-ingest capacity planner.

Standard library only. Every module here is pure: it takes a ``PlannerConfig``
plus measured rates and returns numbers. Nothing reads the clock or the network.
"""

from .config import ACTIVE_ENVIRONMENT, DEFAULTS, PlannerConfig, load_config

__all__ = ["ACTIVE_ENVIRONMENT", "DEFAULTS", "PlannerConfig", "load_config"]
