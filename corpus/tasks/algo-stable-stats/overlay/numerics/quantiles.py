"""Exact order statistics.

Percentiles reported by a telemetry backend have to be reproducible across
shards and across releases, which rules out any definition that depends on the
order the samples arrived in or on the accumulated rounding of a floating point
cumulative weight.  Every positional computation in this module is meant to be
carried out in exact rational arithmetic and rounded exactly once, at the end.

The two routines that do the positional work are not written yet.
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


def quantile(values: Sequence[float], p: float, method: str = "linear") -> float:
    """The ``p``-quantile of ``values`` under the requested interpolation rule."""
    raise NotImplementedError("quantile is not implemented yet")


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
    """The ``p``-quantile of a weighted sample."""
    raise NotImplementedError("weighted_quantile is not implemented yet")
