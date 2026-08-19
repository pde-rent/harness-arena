"""Log-linear bucketing for latency distributions.

Latencies span microseconds to minutes, so a fixed-width histogram is useless.
The layout here divides each power of ``base`` into ``sub_buckets`` equal linear
slices, which bounds the relative width of every bucket while keeping the index
arithmetic cheap.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Tuple

from .errors import DomainError, EmptyInputError
from .moments import MomentState, merge_moments, moments_of, push_moment
from .summation import compensated_sum

__all__ = ["LogLinearLayout", "Histogram"]


@dataclass(frozen=True)
class LogLinearLayout:
    """Bucket boundaries: ``sub_buckets`` linear slices per power of ``base``."""

    base: float = 2.0
    sub_buckets: int = 4
    floor_value: float = 1e-6

    def __post_init__(self) -> None:
        if self.base <= 1.0 or not math.isfinite(self.base):
            raise DomainError("base must be a finite number greater than 1")
        if self.sub_buckets < 1:
            raise DomainError("sub_buckets must be at least 1")
        if self.floor_value <= 0.0 or not math.isfinite(self.floor_value):
            raise DomainError("floor_value must be finite and positive")

    def index(self, value: float) -> int:
        """Index of the bucket holding ``value``; the underflow bucket is ``0``."""
        x = float(value)
        if math.isnan(x):
            raise DomainError("cannot bucket NaN")
        if x < self.floor_value:
            return 0
        if math.isinf(x):
            raise DomainError("cannot bucket an infinite value")
        ratio = math.log(x / self.floor_value, self.base)
        return 1 + int(math.floor(ratio * self.sub_buckets))

    def bounds(self, index: int) -> Tuple[float, float]:
        """Half-open ``[low, high)`` bounds of the bucket at ``index``."""
        if index < 0:
            raise DomainError("bucket index must not be negative")
        if index == 0:
            return (0.0, self.floor_value)
        low = self.floor_value * self.base ** ((index - 1) / self.sub_buckets)
        high = self.floor_value * self.base ** (index / self.sub_buckets)
        return (low, high)

    def midpoint(self, index: int) -> float:
        """Geometric midpoint of a bucket, used as its representative value."""
        low, high = self.bounds(index)
        if index == 0:
            return high / 2.0
        return math.sqrt(low * high)


@dataclass
class Histogram:
    """Counts per bucket plus exact-ish summary statistics of the raw samples."""

    layout: LogLinearLayout = field(default_factory=LogLinearLayout)
    counts: Dict[int, int] = field(default_factory=dict)
    moments: MomentState = field(default_factory=MomentState)

    def add(self, value: float, weight: int = 1) -> None:
        """Record ``value`` ``weight`` times."""
        if weight < 1:
            raise DomainError("weight must be a positive integer")
        index = self.layout.index(value)
        self.counts[index] = self.counts.get(index, 0) + weight
        for _ in range(weight):
            self.moments = push_moment(self.moments, value)

    def extend(self, values: Iterable[float]) -> None:
        """Record every value in ``values``."""
        for value in values:
            self.add(value)

    @property
    def count(self) -> int:
        """Total number of recorded observations."""
        return sum(self.counts.values())

    def total(self) -> float:
        """Compensated sum of the bucket midpoints weighted by their counts."""
        return compensated_sum(
            self.layout.midpoint(index) * count for index, count in sorted(self.counts.items())
        )

    def merge(self, other: "Histogram") -> "Histogram":
        """Combine two histograms sharing the same layout."""
        if other.layout != self.layout:
            raise DomainError("histograms with different layouts cannot be merged")
        counts = dict(self.counts)
        for index, count in other.counts.items():
            counts[index] = counts.get(index, 0) + count
        return Histogram(self.layout, counts, merge_moments(self.moments, other.moments))

    def bucket_quantile(self, p: float) -> float:
        """Bucket-resolution quantile: the midpoint of the bucket covering ``p``."""
        if p < 0.0 or p > 1.0 or math.isnan(p):
            raise DomainError("p must lie in the closed interval [0, 1]")
        total = self.count
        if total == 0:
            raise EmptyInputError("an empty histogram has no quantiles")
        target = p * total
        seen = 0
        ordered: List[int] = sorted(self.counts)
        for index in ordered:
            seen += self.counts[index]
            if seen >= target:
                return self.layout.midpoint(index)
        return self.layout.midpoint(ordered[-1])


def histogram_of(values: Iterable[float], layout: LogLinearLayout | None = None) -> Histogram:
    """Build a histogram from an iterable in one pass."""
    values = list(values)
    hist = Histogram(layout or LogLinearLayout())
    for value in values:
        hist.add(value)
    hist.moments = moments_of(values)
    return hist
