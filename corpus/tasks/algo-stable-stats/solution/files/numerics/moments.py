"""Single-pass streaming moments with an exact parallel merge.

Telemetry shards are aggregated independently and then combined, so a moment
accumulator is useless unless two states that never saw each other's data can be
merged.  The textbook ``sum(x**2)/n - mean**2`` formula cannot do this safely:
on a gauge that hovers around 1e9 with millisecond-scale jitter the two terms
agree to fifteen significant digits and the subtraction annihilates every bit of
the answer, sometimes producing a negative variance.

This module therefore keeps centred sums of powers (Welford for the streaming
update, Chan/Golub/LeVeque for the pairwise merge).
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
    x = _check_finite(value)
    n = state.n + 1
    delta = x - state.mean
    delta_n = delta / n
    term = delta * delta_n * state.n
    m3 = state.m3 + term * delta_n * (n - 2) - 3.0 * delta_n * state.m2
    m2 = state.m2 + term
    return MomentState(n, state.mean + delta_n, m2, m3)


def moments_of(values: Iterable[float]) -> MomentState:
    """Accumulate an iterable of observations in a single pass."""
    state = MomentState()
    for value in values:
        state = push_moment(state, value)
    return state


def merge_moments(left: MomentState, right: MomentState) -> MomentState:
    """Combine two independently accumulated states.

    The result is the state that would have been produced by feeding ``left``'s
    observations followed by ``right``'s observations to a single accumulator.
    """
    if left.n == 0:
        return right
    if right.n == 0:
        return left
    na, nb = left.n, right.n
    n = na + nb
    delta = right.mean - left.mean
    combined_mean = left.mean + delta * (nb / n)
    m2 = left.m2 + right.m2 + delta * delta * (na * nb / n)
    m3 = (
        left.m3
        + right.m3
        + delta * delta * delta * (na * nb * (na - nb) / (n * n))
        + 3.0 * delta * (na * right.m2 - nb * left.m2) / n
    )
    return MomentState(n, combined_mean, m2, m3)


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
    if state.n == 0:
        raise EmptyInputError("variance of an empty sample is undefined")
    denominator = state.n - ddof
    if denominator <= 0:
        raise DomainError("ddof must leave a positive number of degrees of freedom")
    result = state.m2 / denominator
    return 0.0 if result < 0.0 else result


def stdev(state: MomentState, ddof: int = 0) -> float:
    """Square root of :func:`variance`."""
    return math.sqrt(variance(state, ddof))


def skewness(state: MomentState) -> float:
    """Population (Fisher-Pearson) skewness ``sqrt(n) * m3 / m2 ** 1.5``."""
    if state.n < 3:
        raise DomainError("skewness requires at least three observations")
    if state.m2 <= 0.0:
        raise DomainError("skewness is undefined for a zero-variance sample")
    return math.sqrt(state.n) * state.m3 / (state.m2 ** 1.5)
