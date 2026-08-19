"""Integer allocation under exact constraints.

Two problems show up constantly when a continuous quantity has to be reported as
whole units: splitting a budget in proportion to weights so that the parts add
up to the budget exactly, and spreading a fixed number of indivisible units over
buckets whose penalty curves are given as data.

Both are meant to be done here in exact rational arithmetic.  Floating point is not merely
imprecise for this: a remainder that should be exactly 1/2 can land on either
side of the comparison, which changes which bucket receives the last unit.

The two allocation routines are not written yet.
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
    """Apportion ``total`` whole units across ``weights`` (Hamilton's method)."""
    raise NotImplementedError("largest_remainder is not implemented yet")


def min_penalty_allocation(
    units: int, costs: Sequence[Sequence[Number]]
) -> Tuple[Fraction, List[int]]:
    """Spread ``units`` indivisible units over buckets to minimise total penalty.

    ``costs[i][k]`` is the penalty incurred when bucket ``i`` receives exactly
    ``k`` units, so bucket ``i`` may hold anything from ``0`` to
    ``len(costs[i]) - 1`` units.  Returns the exact optimal total penalty and the
    lexicographically smallest allocation achieving it.
    """
    raise NotImplementedError("min_penalty_allocation is not implemented yet")
