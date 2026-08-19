"""Integer allocation under exact constraints.

Two problems show up constantly when a continuous quantity has to be reported as
whole units: splitting a budget in proportion to weights so that the parts add
up to the budget exactly, and spreading a fixed number of indivisible units over
buckets whose penalty curves are given as data.

Both are done here in exact rational arithmetic.  Floating point is not merely
imprecise for this: a remainder that should be exactly 1/2 can land on either
side of the comparison, which changes which bucket receives the last unit.
"""

from __future__ import annotations

import math
from decimal import Decimal
from fractions import Fraction
from typing import List, Sequence, Tuple

from .errors import AllocationError, DomainError

__all__ = [
    "to_exact",
    "is_convex",
    "allocation_cost",
    "largest_remainder",
    "min_penalty_allocation",
]

Number = int | float | Fraction | Decimal


def to_exact(value: Number) -> Fraction:
    """Convert ``value`` to the rational it denotes, with no rounding at all."""
    if isinstance(value, Fraction):
        return value
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise DomainError("non-finite Decimal cannot be converted exactly")
        return Fraction(value)
    x = float(value)
    if not math.isfinite(x):
        raise DomainError("non-finite value cannot be converted exactly")
    return Fraction(x)


def is_convex(row: Sequence[Number]) -> bool:
    """Whether a penalty row is discretely convex.

    True when every second difference ``row[k + 1] - 2 * row[k] + row[k - 1]`` is
    non-negative, which is exactly the condition under which allocating units one
    at a time to the cheapest marginal bucket is optimal.  Rows of length two or
    less are convex.
    """
    exact = [to_exact(value) for value in row]
    if len(exact) <= 2:
        return True
    return all(
        exact[k + 1] - 2 * exact[k] + exact[k - 1] >= 0
        for k in range(1, len(exact) - 1)
    )


def allocation_cost(costs: Sequence[Sequence[Number]], allocation: Sequence[int]) -> Fraction:
    """Total penalty of ``allocation`` against the penalty table ``costs``."""
    if len(allocation) != len(costs):
        raise DomainError("allocation and costs must describe the same buckets")
    total = Fraction(0)
    for row, units in zip(costs, allocation):
        if not isinstance(units, int) or isinstance(units, bool):
            raise DomainError("allocations must be integers")
        if units < 0 or units >= len(row):
            raise DomainError("allocation is outside the bucket's capacity")
        total += to_exact(row[units])
    return total


def largest_remainder(weights: Sequence[Number], total: int) -> List[int]:
    """Apportion ``total`` whole units across ``weights`` (Hamilton's method).

    Each bucket's exact quota is ``weights[i] * total / sum(weights)``.  Every
    bucket first receives the floor of its quota, and the units still unassigned
    go one apiece to the buckets with the largest fractional remainder.  Ties on
    the remainder are settled by the larger quota, and ties on that by the lower
    index.  The returned list always sums to ``total`` exactly.
    """
    if not isinstance(total, int) or isinstance(total, bool):
        raise DomainError("total must be an integer")
    if total < 0:
        raise DomainError("total must not be negative")

    exact = [to_exact(w) for w in weights]
    if any(w < 0 for w in exact):
        raise DomainError("weights must not be negative")

    if not exact:
        if total == 0:
            return []
        raise AllocationError("cannot apportion a positive total across no buckets")

    mass = sum(exact, Fraction(0))
    if mass == 0:
        if total == 0:
            return [0] * len(exact)
        raise AllocationError("cannot apportion a positive total across zero weight")

    quotas = [w * total / mass for w in exact]
    base = [math.floor(q) for q in quotas]
    remaining = total - sum(base)

    ranked = sorted(
        range(len(exact)),
        key=lambda i: (-(quotas[i] - base[i]), -quotas[i], i),
    )
    for i in ranked[:remaining]:
        base[i] += 1
    return base


def min_penalty_allocation(
    units: int, costs: Sequence[Sequence[Number]]
) -> Tuple[Fraction, List[int]]:
    """Spread ``units`` indivisible units over buckets to minimise total penalty.

    ``costs[i][k]`` is the penalty incurred when bucket ``i`` receives exactly
    ``k`` units, so bucket ``i`` may hold anything from ``0`` to
    ``len(costs[i]) - 1`` units.  Returns the exact optimal total penalty and the
    lexicographically smallest allocation achieving it.
    """
    if not isinstance(units, int) or isinstance(units, bool):
        raise DomainError("units must be an integer")
    if units < 0:
        raise DomainError("units must not be negative")

    table: List[List[Fraction]] = []
    for row in costs:
        values = [to_exact(value) for value in row]
        if not values:
            raise DomainError("every bucket needs at least one penalty entry")
        table.append(values)

    n = len(table)
    if n == 0:
        if units == 0:
            return Fraction(0), []
        raise AllocationError("cannot place units when there are no buckets")

    capacity = sum(len(row) - 1 for row in table)
    if capacity < units:
        raise AllocationError("total bucket capacity is smaller than the units to place")

    # suffix[i][u] = minimum penalty of placing exactly u units in buckets i..n-1
    infinity = None
    suffix: List[List[Fraction | None]] = [[infinity] * (units + 1) for _ in range(n + 1)]
    suffix[n][0] = Fraction(0)
    for i in range(n - 1, -1, -1):
        row = table[i]
        cap = len(row) - 1
        for u in range(units + 1):
            best: Fraction | None = None
            for k in range(min(cap, u) + 1):
                rest = suffix[i + 1][u - k]
                if rest is None:
                    continue
                candidate = row[k] + rest
                if best is None or candidate < best:
                    best = candidate
            suffix[i][u] = best

    optimum = suffix[0][units]
    if optimum is None:
        raise AllocationError("no allocation satisfies the capacity constraints")

    allocation: List[int] = []
    left = units
    for i in range(n):
        row = table[i]
        cap = len(row) - 1
        target = suffix[i][left]
        chosen = None
        for k in range(min(cap, left) + 1):
            rest = suffix[i + 1][left - k]
            if rest is None:
                continue
            if row[k] + rest == target:
                chosen = k
                break
        if chosen is None:  # pragma: no cover - guarded by the capacity check above
            raise AllocationError("reconstruction failed")
        allocation.append(chosen)
        left -= chosen
    return optimum, allocation
