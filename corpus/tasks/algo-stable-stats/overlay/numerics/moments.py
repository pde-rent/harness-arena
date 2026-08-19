"""Single-pass streaming moments with an exact parallel merge.

Telemetry shards are aggregated independently and then combined, so a moment
accumulator is useless unless two states that never saw each other's data can be
merged.  The textbook ``sum(x**2)/n - mean**2`` formula cannot do this safely:
on a gauge that hovers around 1e9 with millisecond-scale jitter the two terms
agree to fifteen significant digits and the subtraction annihilates every bit of
the answer, sometimes producing a negative variance.

The accumulator below keeps centred sums of powers.  The bodies that maintain
them are not written yet.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

from .errors import DomainError, EmptyInputError

__all__ = [
    "MomentState",
    "push_moment",
    "moments_of",
    "merge_moments",
    "merge_many_moments",
    "mean",
    "variance",
    "stdev",
    "skewness",
]


@dataclass(frozen=True)
class MomentState:
    """Centred moment accumulator.

    ``m2`` is the sum of squared deviations from the mean and ``m3`` the sum of
    cubed deviations, both taken about the mean of the same ``n`` observations.
    """

    n: int = 0
    mean: float = 0.0
    m2: float = 0.0
    m3: float = 0.0


def _check_finite(value: float) -> float:
    x = float(value)
    if not math.isfinite(x):
        raise DomainError("moment accumulators require finite observations")
    return x


def push_moment(state: MomentState, value: float) -> MomentState:
    """Fold one observation into ``state`` and return the new state."""
    raise NotImplementedError("push_moment is not implemented yet")


def moments_of(values: Iterable[float]) -> MomentState:
    """Accumulate an iterable of observations in a single pass."""
    raise NotImplementedError("moments_of is not implemented yet")


def merge_moments(left: MomentState, right: MomentState) -> MomentState:
    """Combine two independently accumulated states.

    The result is the state that would have been produced by feeding ``left``'s
    observations followed by ``right``'s observations to a single accumulator.
    """
    raise NotImplementedError("merge_moments is not implemented yet")


def merge_many_moments(states: Iterable[MomentState]) -> MomentState:
    """Left-fold :func:`merge_moments` over ``states``."""
    out = MomentState()
    for state in states:
        out = merge_moments(out, state)
    return out


def mean(state: MomentState) -> float:
    """Arithmetic mean of the observations behind ``state``."""
    if state.n == 0:
        raise EmptyInputError("mean of an empty sample is undefined")
    return state.mean


def variance(state: MomentState, ddof: int = 0) -> float:
    """Variance with ``ddof`` delta degrees of freedom (0 = population)."""
    raise NotImplementedError("variance is not implemented yet")


def stdev(state: MomentState, ddof: int = 0) -> float:
    """Square root of :func:`variance`."""
    return math.sqrt(variance(state, ddof))


def skewness(state: MomentState) -> float:
    """Population (Fisher-Pearson) skewness ``sqrt(n) * m3 / m2 ** 1.5``."""
    raise NotImplementedError("skewness is not implemented yet")
