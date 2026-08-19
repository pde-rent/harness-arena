"""End-to-end plan: measured rates plus configuration in, sizing and cost out."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from . import batching, ingest, rates, retention, sharding
from .config import PlannerConfig, load_config
from .pricing import monthly_cost, within_budget


@dataclass(frozen=True)
class Plan:
    peak_events_per_second: int
    avg_payload_bytes: int
    compressed_peak_bytes_per_second: int
    events_per_batch: int
    batches_per_second: int
    shards: sharding.ShardPlan
    retention_window_days: int
    hot_tier_bytes: int
    hot_tier_gib: int
    monthly_cost_usd: Decimal


def build_plan(cfg: PlannerConfig, samples: list[rates.HourSample]) -> Plan:
    rows = rates.billable(samples, cfg.billable_fleet)
    eps = rates.peak_events_per_second(rows)
    avg = rates.average_payload_bytes(rows)
    bps = ingest.compressed_bytes_per_second(eps, avg, cfg.compression_ratio)
    per_batch = batching.events_per_batch(cfg, avg)
    bpsec = batching.batches_per_second(cfg, eps, avg)
    shard_plan = sharding.plan_shards(cfg, eps, bps)
    daily = ingest.daily_compressed_bytes(rates.daily_events(rows), avg, cfg.compression_ratio)
    hot_bytes = retention.hot_tier_bytes(cfg, daily)
    hot_gib = retention.to_gib(hot_bytes)
    return Plan(
        peak_events_per_second=eps,
        avg_payload_bytes=avg,
        compressed_peak_bytes_per_second=bps,
        events_per_batch=per_batch,
        batches_per_second=bpsec,
        shards=shard_plan,
        retention_window_days=retention.retention_window_days(cfg),
        hot_tier_bytes=hot_bytes,
        hot_tier_gib=hot_gib,
        monthly_cost_usd=monthly_cost(cfg, hot_gib, shard_plan.shards),
    )


def max_retention_days_within_budget(cfg: PlannerConfig, samples: list[rates.HourSample]) -> int:
    """Largest whole ``retention_days`` whose monthly invoice stays within budget.

    Only retention changes; the shard count and the daily volume are fixed by the
    measured rates. Returns -1 if even a zero-day retention busts the budget.
    """
    base = build_plan(cfg, samples)
    days = -1
    for candidate in range(0, cfg.retention_days + 366):
        probe = build_plan(cfg.replace(retention_days=candidate), samples)
        if within_budget(cfg, probe.hot_tier_gib, base.shards.shards):
            days = candidate
        else:
            break
    return days


def default_plan() -> Plan:
    cfg = load_config()
    return build_plan(cfg, rates.load_samples())
