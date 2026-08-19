"""Half-open interval algebra over exact rationals.

Retention windows, maintenance windows and alert-suppression windows all need to
be merged, intersected and measured.  Endpoints are stored as
:class:`fractions.Fraction` so that coverage totals are exact no matter how the
inputs were expressed.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Iterable, List, Sequence

from .allocate import to_exact
from .errors import DomainError

__all__ = [
    "Interval",
    "interval",
    "merge_intervals",
    "total_coverage",
    "intersect_intervals",
    "subtract_intervals",
    "covers",
]


@dataclass(frozen=True, order=True)
class Interval:
    """The half-open interval ``[start, end)``."""

    start: Fraction
    end: Fraction

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise DomainError("interval end must not precede its start")

    @property
    def length(self) -> Fraction:
        """Exact width of the interval."""
        return self.end - self.start

    @property
    def empty(self) -> bool:
        """Whether the interval contains no points."""
        return self.end == self.start


def interval(start, end) -> Interval:
    """Build an :class:`Interval` from anything :func:`to_exact` understands."""
    return Interval(to_exact(start), to_exact(end))


def merge_intervals(items: Iterable[Interval]) -> List[Interval]:
    """Sort and coalesce overlapping or touching intervals; drops empty ones."""
    ordered = sorted((i for i in items if not i.empty), key=lambda i: (i.start, i.end))
    merged: List[Interval] = []
    for item in ordered:
        if merged and item.start <= merged[-1].end:
            last = merged[-1]
            if item.end > last.end:
                merged[-1] = Interval(last.start, item.end)
        else:
            merged.append(item)
    return merged


def total_coverage(items: Iterable[Interval]) -> Fraction:
    """Exact measure of the union of ``items``."""
    return sum((i.length for i in merge_intervals(items)), Fraction(0))


def intersect_intervals(left: Sequence[Interval], right: Sequence[Interval]) -> List[Interval]:
    """Intersection of two interval sets, returned merged and sorted."""
    a = merge_intervals(left)
    b = merge_intervals(right)
    out: List[Interval] = []
    i = j = 0
    while i < len(a) and j < len(b):
        start = max(a[i].start, b[j].start)
        end = min(a[i].end, b[j].end)
        if start < end:
            out.append(Interval(start, end))
        if a[i].end <= b[j].end:
            i += 1
        else:
            j += 1
    return out


def subtract_intervals(left: Sequence[Interval], right: Sequence[Interval]) -> List[Interval]:
    """Everything in ``left`` that is not covered by ``right``."""
    out: List[Interval] = []
    holes = merge_intervals(right)
    for item in merge_intervals(left):
        cursor = item.start
        for hole in holes:
            if hole.end <= cursor or hole.start >= item.end:
                continue
            if hole.start > cursor:
                out.append(Interval(cursor, hole.start))
            cursor = max(cursor, hole.end)
            if cursor >= item.end:
                break
        if cursor < item.end:
            out.append(Interval(cursor, item.end))
    return out


def covers(items: Sequence[Interval], point) -> bool:
    """Whether any interval in ``items`` contains ``point``."""
    x = to_exact(point)
    return any(i.start <= x < i.end for i in merge_intervals(items))
