"""Compensated (error-tracking) summation.

Telemetry aggregation adds long runs of floating point numbers whose magnitudes
differ by many orders of magnitude: a counter sitting at 1e12 receiving deltas of
1e-3, or a gauge whose positive and negative excursions cancel almost exactly.
Naive left-to-right addition throws the low bits of every partial sum away, so
this module keeps a running compensation term alongside the running total.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Sequence

__all__ = [
    "SumState",
    "compensated_sum",
    "compensated_cumsum",
    "sum_state",
    "merge_sum_states",
    "total_of",
]


@dataclass(frozen=True)
class SumState:
    """A partial compensated sum.

    ``total`` is the running high-order accumulator and ``compensation`` holds
    the low-order bits that ``total`` could not represent.  ``nan_seen``,
    ``pos_inf_seen`` and ``neg_inf_seen`` record the non-finite inputs so that
    the special-value rules can be applied once, at the end, instead of letting
    an infinity poison the compensation term.
    """

    total: float = 0.0
    compensation: float = 0.0
    count: int = 0
    nan_seen: bool = False
    pos_inf_seen: bool = False
    neg_inf_seen: bool = False


def _classify(state: SumState) -> float | None:
    """Return the mandated special value for ``state``, or None if finite."""
    if state.nan_seen or (state.pos_inf_seen and state.neg_inf_seen):
        return math.nan
    if state.pos_inf_seen:
        return math.inf
    if state.neg_inf_seen:
        return -math.inf
    return None


def _push(state: SumState, value: float) -> SumState:
    x = float(value)
    if math.isnan(x):
        return SumState(
            state.total,
            state.compensation,
            state.count + 1,
            True,
            state.pos_inf_seen,
            state.neg_inf_seen,
        )
    if math.isinf(x):
        return SumState(
            state.total,
            state.compensation,
            state.count + 1,
            state.nan_seen,
            state.pos_inf_seen or x > 0.0,
            state.neg_inf_seen or x < 0.0,
        )

    total = state.total
    new_total = total + x
    if abs(total) >= abs(x):
        lost = (total - new_total) + x
    else:
        lost = (x - new_total) + total
    return SumState(
        new_total,
        state.compensation + lost,
        state.count + 1,
        state.nan_seen,
        state.pos_inf_seen,
        state.neg_inf_seen,
    )


def sum_state(values: Iterable[float]) -> SumState:
    """Accumulate ``values`` into a :class:`SumState`."""
    state = SumState()
    for value in values:
        state = _push(state, value)
    return state


def merge_sum_states(left: SumState, right: SumState) -> SumState:
    """Combine two independently accumulated partial sums."""
    merged = _push(SumState(left.total, left.compensation, 0), right.total)
    return SumState(
        merged.total,
        merged.compensation + right.compensation,
        left.count + right.count,
        left.nan_seen or right.nan_seen,
        left.pos_inf_seen or right.pos_inf_seen,
        left.neg_inf_seen or right.neg_inf_seen,
    )


def total_of(state: SumState) -> float:
    """Collapse a :class:`SumState` into the single float it represents."""
    special = _classify(state)
    if special is not None:
        return special
    return state.total + state.compensation


def compensated_sum(values: Iterable[float]) -> float:
    """Sum ``values`` while tracking the rounding error of every addition.

    Non-finite inputs are handled by inspection rather than by arithmetic: a NaN
    anywhere, or both a positive and a negative infinity, yields NaN; otherwise a
    single-signed infinity yields that infinity; otherwise the compensated total
    of the finite inputs is returned.  The empty input sums to ``0.0``.
    """
    return total_of(sum_state(values))


def compensated_cumsum(values: Iterable[float]) -> List[float]:
    """Running totals: element ``k`` equals ``compensated_sum(values[:k + 1])``."""
    out: List[float] = []
    state = SumState()
    for value in values:
        state = _push(state, value)
        out.append(total_of(state))
    return out
