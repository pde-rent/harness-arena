"""Hot-tier retention.

``retention_days`` counts *completed* days of history that must remain queryable.
The day currently in progress is always resident on top of that, so the hot tier
physically holds ``retention_days + 1`` days of data at the end of the window.

Every retained byte exists ``replication_factor`` times.
"""

from __future__ import annotations

import math

from .config import BYTES_PER_GIB, PlannerConfig


def retention_window_days(cfg: PlannerConfig) -> int:
    """Days of data physically resident in the hot tier."""
    return cfg.retention_days + 1


def hot_tier_bytes(cfg: PlannerConfig, daily_compressed_bytes: int) -> int:
    """Bytes occupied by the hot tier once the window is full, all replicas counted."""
    return daily_compressed_bytes * retention_window_days(cfg) * cfg.replication_factor


def to_gib(byte_count: int) -> int:
    """Bytes as whole GiB, rounded up: storage is billed by the started GiB."""
    return math.ceil(byte_count / BYTES_PER_GIB)
