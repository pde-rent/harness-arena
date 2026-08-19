"""Billing.

The monthly invoice has two lines:

1. Hot-tier storage. The free allowance is deducted from the stored GiB *first*;
   whatever is left is then walked through the price tiers in order, so the tier
   sizes measure billable GiB and not stored GiB. A fleet inside the allowance
   pays nothing for storage.
2. Provisioned shards, billed whole regardless of utilisation.

All money is computed with ``decimal.Decimal`` and only the final invoice total
is rounded, to cents, half away from zero.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from .config import PlannerConfig

CENT = Decimal("0.01")


def billable_gib(cfg: PlannerConfig, stored_gib: int) -> int:
    """Stored GiB after the monthly free allowance has been deducted."""
    return max(0, stored_gib - cfg.hot_tier_free_gib)


def storage_cost(cfg: PlannerConfig, stored_gib: int) -> Decimal:
    """Untruncated hot-tier storage charge for a month."""
    remaining = billable_gib(cfg, stored_gib)
    total = Decimal("0")
    for size, rate in cfg.price_tiers:
        if remaining <= 0:
            break
        take = remaining if size is None else min(remaining, size)
        total += Decimal(take) * Decimal(rate)
        remaining -= take
    return total


def shard_cost(cfg: PlannerConfig, shards: int) -> Decimal:
    return Decimal(shards) * Decimal(cfg.shard_monthly_usd)


def monthly_cost(cfg: PlannerConfig, stored_gib: int, shards: int) -> Decimal:
    """Invoice total for a month, rounded to cents."""
    raw = storage_cost(cfg, stored_gib) + shard_cost(cfg, shards)
    return raw.quantize(CENT, rounding=ROUND_HALF_UP)


def within_budget(cfg: PlannerConfig, stored_gib: int, shards: int) -> bool:
    """A month is within budget when its rounded total does not exceed the budget."""
    return monthly_cost(cfg, stored_gib, shards) <= Decimal(cfg.monthly_budget_usd)
