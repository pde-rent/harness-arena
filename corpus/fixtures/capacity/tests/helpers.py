"""Shared synthetic fixtures for the unit tests."""

from __future__ import annotations

from capacity.config import DEFAULTS, PlannerConfig
from capacity.rates import HourSample


def make_config(**overrides) -> PlannerConfig:
    base = dict(DEFAULTS)
    base["price_tiers"] = tuple((s, r) for s, r in base["price_tiers"])
    base.update(overrides)
    return PlannerConfig(**base)


def samples(events_by_hour, fleet="prod", payload_per_event=1000):
    return [
        HourSample(hour_utc=h, fleet=fleet, events=e, payload_bytes=e * payload_per_event)
        for h, e in enumerate(events_by_hour)
    ]
