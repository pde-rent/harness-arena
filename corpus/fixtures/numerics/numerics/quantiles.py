"""Exact order statistics.

Percentiles reported by a telemetry backend have to be reproducible across
shards and across releases, which rules out any definition that depends on the
order the samples arrived in or on the accumulated rounding of a floating point
cumulative weight.  Every positional computation in this module is therefore
carried out in exact rational arithmetic and rounded exactly once, at the end.
"""

from __future__ import annotations

import math
from fractions import Fraction
from typing import List, Sequence

from .errors import DomainError, EmptyInputError

__all__ = [
    "METHODS",
    "quantile",
    "quantiles",
    "median",
    "weighted_quantile",
]

#: The interpolation rules :func:`quantile` understands.
METHODS = ("linear", "lower", "higher", "nearest", "midpoint")


def _finite_floats(values: Sequence[float]) -> List[float]:
    out: List[float] = []
    for value in values:
        x = float(value)
        if not math.isfinite(x):
            raise DomainError("quantiles require finite samples")
        out.append(x)
    if not out:
        raise EmptyInputError("quantiles of an empty sample are undefined")
    return out


def _fraction_p(p: float) -> Fraction:
    x = float(p)
    if math.isnan(x) or x < 0.0 or x > 1.0:
        raise DomainError("p must lie in the closed interval [0, 1]")
    return Fraction(x)


def _round_half_even(value: Fraction) -> int:
    floor = math.floor(value)
    remainder = value - floor
    if remainder < Fraction(1, 2):
        return floor
    if remainder > Fraction(1, 2):
        return floor + 1
    return floor if floor % 2 == 0 else floor + 1


def quantile(values: Sequence[float], p: float, method: str = "linear") -> float:
    """The ``p``-quantile of ``values`` under the requested interpolation rule.

    The sample is sorted ascending; with ``n`` observations the target position
    is the exact rational ``h = (n - 1) * p``, and ``lo`` / ``hi`` are its floor
    and ceiling.  ``linear`` interpolates between ``x[lo]`` and ``x[hi]`` by the
    fractional part of ``h`` in exact arithmetic, ``lower`` and ``higher`` take
    the bracketing observations, ``nearest`` rounds ``h`` to an integer index
    with ties going to the even index, and ``midpoint`` averages the two
    bracketing observations.
    """
    if method not in METHODS:
        raise DomainError(f"unknown interpolation method: {method!r}")
    xs = sorted(_finite_floats(values))
    ratio = _fraction_p(p)
    n = len(xs)
    if n == 1:
        return xs[0]
    h = Fraction(n - 1) * ratio
    lo = math.floor(h)
    hi = math.ceil(h)
    if method == "lower":
        return xs[lo]
    if method == "higher":
        return xs[hi]
    if method == "nearest":
        return xs[_round_half_even(h)]
    if method == "midpoint":
        return float((Fraction(xs[lo]) + Fraction(xs[hi])) / 2)
    gap = h - lo
    if gap == 0:
        return xs[lo]
    exact = Fraction(xs[lo]) + gap * (Fraction(xs[hi]) - Fraction(xs[lo]))
    return float(exact)


def quantiles(values: Sequence[float], ps: Sequence[float], method: str = "linear") -> List[float]:
    """Evaluate :func:`quantile` at several probabilities, sorting once."""
    xs = sorted(_finite_floats(values))
    return [quantile(xs, p, method) for p in ps]


def median(values: Sequence[float]) -> float:
    """The 0.5-quantile under the ``linear`` rule."""
    return quantile(values, 0.5)


def weighted_quantile(
    values: Sequence[float], weights: Sequence[float], p: float
) -> float:
    """The ``p``-quantile of a weighted sample.

    Observations are sorted ascending by value.  With cumulative weights
    ``S[k] = w[0] + ... + w[k]`` and total weight ``W = S[n - 1]``, observation
    ``k`` is anchored at the plotting position ``c[k] = (S[k] - w[k] / 2) / W``,
    i.e. the midpoint of the weight interval it occupies.  For ``p <= c[0]`` the
    smallest observation is returned and for ``p >= c[n - 1]`` the largest;
    otherwise the result interpolates linearly in ``p`` between the two
    consecutive anchors that bracket it.  All positions are exact rationals.
    """
    xs = _finite_floats(values)
    if len(weights) != len(xs):
        raise DomainError("values and weights must have the same length")
    ws: List[Fraction] = []
    for weight in weights:
        w = float(weight)
        if not math.isfinite(w) or w <= 0.0:
            raise DomainError("weights must be finite and strictly positive")
        ws.append(Fraction(w))
    ratio = _fraction_p(p)

    order = sorted(range(len(xs)), key=lambda i: xs[i])
    sorted_x = [Fraction(xs[i]) for i in order]
    sorted_w = [ws[i] for i in order]

    total = sum(sorted_w, Fraction(0))
    anchors: List[Fraction] = []
    running = Fraction(0)
    for w in sorted_w:
        running += w
        anchors.append((running - w / 2) / total)

    if ratio <= anchors[0]:
        return float(sorted_x[0])
    if ratio >= anchors[-1]:
        return float(sorted_x[-1])
    for k in range(len(anchors) - 1):
        left, right = anchors[k], anchors[k + 1]
        if left <= ratio <= right:
            if right == left:
                return float(sorted_x[k + 1])
            gap = (ratio - left) / (right - left)
            return float(sorted_x[k] + gap * (sorted_x[k + 1] - sorted_x[k]))
    return float(sorted_x[-1])
