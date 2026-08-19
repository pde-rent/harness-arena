"""numerics — numerically careful aggregation primitives for telemetry pipelines.

The package is deliberately dependency-free and deterministic: every routine is
a pure function of its arguments, nothing consults a clock, a network or a
random source, and everything that can be computed exactly is computed exactly.

Modules
-------
``summation``   compensated (error-tracking) floating point summation
``moments``     single-pass mean / variance / skewness with a parallel merge
``quantiles``   order statistics with several interpolation rules
``histogram``   log-linear bucketing of long-tailed distributions
``intervals``   half-open interval algebra over exact rationals
``allocate``    integer apportionment and minimum-penalty unit placement
``rounding``    decimal rounding rules and total-preserving splits
``errors``      the exception hierarchy shared by all of the above
"""

from .errors import AllocationError, DomainError, EmptyInputError, NumericsError
from .summation import (
    SumState,
    compensated_cumsum,
    compensated_sum,
    merge_sum_states,
    sum_state,
    total_of,
)
from .moments import (
    MomentState,
    mean,
    merge_many_moments,
    merge_moments,
    moments_of,
    push_moment,
    skewness,
    stdev,
    variance,
)
from .quantiles import METHODS, median, quantile, quantiles, weighted_quantile
from .histogram import Histogram, LogLinearLayout, histogram_of
from .intervals import (
    Interval,
    covers,
    intersect_intervals,
    interval,
    merge_intervals,
    subtract_intervals,
    total_coverage,
)
from .allocate import (
    allocation_cost,
    is_convex,
    largest_remainder,
    min_penalty_allocation,
    to_exact,
)
from .rounding import (
    MODES,
    distribute_decimal,
    round_decimal,
    round_half_even,
    round_half_up,
    round_to_step,
)

__version__ = "0.4.0"

__all__ = [
    "NumericsError",
    "EmptyInputError",
    "DomainError",
    "AllocationError",
    "SumState",
    "compensated_sum",
    "compensated_cumsum",
    "sum_state",
    "merge_sum_states",
    "total_of",
    "MomentState",
    "push_moment",
    "moments_of",
    "merge_moments",
    "merge_many_moments",
    "mean",
    "variance",
    "stdev",
    "skewness",
    "METHODS",
    "quantile",
    "quantiles",
    "median",
    "weighted_quantile",
    "LogLinearLayout",
    "Histogram",
    "histogram_of",
    "Interval",
    "interval",
    "merge_intervals",
    "total_coverage",
    "intersect_intervals",
    "subtract_intervals",
    "covers",
    "to_exact",
    "is_convex",
    "allocation_cost",
    "largest_remainder",
    "min_penalty_allocation",
    "MODES",
    "round_decimal",
    "round_half_even",
    "round_half_up",
    "round_to_step",
    "distribute_decimal",
    "__version__",
]
