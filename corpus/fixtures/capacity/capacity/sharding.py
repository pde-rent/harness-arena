"""Shard sizing.

A shard has two independent ceilings and must satisfy both. The fleet therefore
needs whichever ceiling demands more shards; a shard is indivisible, so both
counts round up.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import PlannerConfig


@dataclass(frozen=True)
class ShardPlan:
    shards_for_events: int
    shards_for_bytes: int
    #: Name of the configuration field whose ceiling decides the shard count.
    binding_limit_field: str

    @property
    def shards(self) -> int:
        return max(self.shards_for_events, self.shards_for_bytes)


def plan_shards(cfg: PlannerConfig, events_per_second: int, bytes_per_second: int) -> ShardPlan:
    by_events = math.ceil(events_per_second / cfg.shard_max_events_per_second)
    by_bytes = math.ceil(bytes_per_second / cfg.shard_max_bytes_per_second)
    binding = (
        "shard_max_events_per_second" if by_events >= by_bytes else "shard_max_mib_per_second"
    )
    return ShardPlan(shards_for_events=by_events, shards_for_bytes=by_bytes, binding_limit_field=binding)
