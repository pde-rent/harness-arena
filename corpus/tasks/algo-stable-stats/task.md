# Implement the numerically stable core of the telemetry toolkit

This repository is `numerics`, a dependency-free Python library of aggregation primitives for a
telemetry pipeline. Three of its modules have had their hard routines removed and replaced with
`raise NotImplementedError`. The test suite is red as a result, and several modules that build on
them (`histogram.py` in particular) are red too.

Implement the missing routines so that the suite passes. Everything is graded on behaviour, so the
spec below is what matters, not the shape of the code.

## Ground rules

- Python 3.11 or newer, standard library only. `math`, `fractions`, `decimal`, `itertools`,
  `dataclasses` and `typing` are all available and all fair game. No third-party packages.
- No network, no clock, no randomness. Every routine must be a pure function of its arguments.
- Do not change any exported name or signature, and do not weaken, delete or skip any existing
  test. You may add code and add tests.
- Exported names and their meanings are described below; where a routine raises, it raises the
  exception class named, from `numerics.errors`.

---

## 1. `numerics/summation.py` — compensated summation

Naive left-to-right addition of floats discards the low-order bits of every partial sum. On
telemetry data this is not a rounding nuisance, it is total loss: summing
`[1e100, 1.0, -1e100, 1.0]` from left to right yields `0.0` when the answer is `2.0`.

Implement `sum_state`, `merge_sum_states`, `total_of`, `compensated_sum` and `compensated_cumsum`
so that they carry an explicit compensation term alongside the running total — the
Kahan–Babuška–Neumaier scheme, which unlike plain Kahan is also correct when the incoming value is
larger in magnitude than the accumulated total.

**Accuracy requirement.** Whenever every input is finite, `compensated_sum(values)` must return the
correctly rounded double nearest to the exact mathematical sum of those inputs. In particular the
result must not depend on the order in which the inputs are presented, and must be exactly `2.0`
for `[1e100, 1.0, -1e100, 1.0]` and every permutation of it.

**Non-finite inputs are decided by inspection, not by arithmetic.** Scan the inputs and classify:

1. if any input is NaN, the result is NaN;
2. otherwise, if the inputs contain both `+inf` and `-inf`, the result is NaN;
3. otherwise, if the inputs contain `+inf`, the result is `+inf`;
4. otherwise, if the inputs contain `-inf`, the result is `-inf`;
5. otherwise the result is the compensated total of the (all finite) inputs.

An infinity must therefore never be added into the accumulator, because that would turn the
compensation term into a NaN and destroy the finite part of the answer as well.

`compensated_sum([])` is `0.0`.

### `SumState`

`SumState` is a frozen dataclass with fields `total`, `compensation`, `count`, `nan_seen`,
`pos_inf_seen`, `neg_inf_seen`, defaulting to `0.0, 0.0, 0, False, False, False`. It is already
declared; you supply the routines that build and consume it.

- `sum_state(values)` folds an iterable into a `SumState`. `count` counts **every** value offered,
  including the non-finite ones. The three boolean flags record whether a NaN, a `+inf` and a
  `-inf` were seen. Any iterable is acceptable, including a one-shot generator.
- `total_of(state)` collapses a state to one float by applying the five-way classification above to
  the flags, and otherwise returning the compensated total the state represents.
- `merge_sum_states(left, right)` returns the state you would have got by accumulating `left`'s
  inputs followed by `right`'s. Counts add, flags OR together, and the compensated totals combine
  without losing the compensation of either side. Merging must be associative in the sense that
  `total_of` of any bracketing of the same three states gives the same double.
- `compensated_sum(values)` is `total_of(sum_state(values))`.
- `compensated_cumsum(values)` returns a list whose element `k` equals
  `compensated_sum(values[:k + 1])` — so a NaN or infinity encountered at position `j` shows up from
  index `j` onwards, and the last element equals `compensated_sum(values)`. The empty input gives
  the empty list.

---

## 2. `numerics/moments.py` — streaming moments with a parallel merge

`MomentState` is a frozen dataclass with fields `n`, `mean`, `m2`, `m3` defaulting to
`0, 0.0, 0.0, 0.0`, where for a sample of `n` observations with arithmetic mean `mean`:

- `m2` is the sum over the sample of `(x - mean) ** 2`;
- `m3` is the sum over the sample of `(x - mean) ** 3`.

These are **centred** sums, not raw power sums. Computing them as `sum(x**2) - n*mean**2` is the
failure this module exists to avoid: on a gauge hovering around `1e9` with unit-scale jitter the
two terms agree to fifteen significant digits and the subtraction annihilates the answer, sometimes
returning a negative variance.

Implement:

- `push_moment(state, value)` — fold one observation in and return a **new** state; the argument
  must not be mutated. A non-finite `value` raises `DomainError`. Use the Welford update, so that
  `m2` and `m3` are updated from the deviation of the new value about the running mean, with `m3`
  updated **before** `m2` (it needs the old `m2`). Starting from the default state, the first
  observation gives `n = 1`, `mean = value`, `m2 = 0.0`, `m3 = 0.0`.
- `moments_of(values)` — fold an iterable, left to right, exactly as repeated `push_moment` would.
  The empty iterable gives the default `MomentState()`.
- `merge_moments(left, right)` — combine two independently accumulated states into the state that
  the two samples concatenated would have produced. Merging with a state of `n = 0` returns the
  other state unchanged (identically, including its `mean`). This is the Chan–Golub–LeVeque
  pairwise combination: with `na`, `nb`, `n = na + nb` and `delta = right.mean - left.mean`,

  - the combined mean is `left.mean + delta * nb / n`;
  - the combined `m2` is `left.m2 + right.m2 + delta**2 * na * nb / n`;
  - the combined `m3` is
    `left.m3 + right.m3 + delta**3 * na * nb * (na - nb) / n**2 + 3 * delta * (na * right.m2 - nb * left.m2) / n`.

- `merge_many_moments(states)` — left-fold `merge_moments` starting from `MomentState()`.
- `variance(state, ddof=0)` — `m2 / (n - ddof)`, clamped at `0.0` so a tiny negative rounding
  residue never escapes. `n == 0` raises `EmptyInputError`; `n - ddof <= 0` raises `DomainError`.
- `skewness(state)` — the population (Fisher–Pearson) coefficient `sqrt(n) * m3 / m2 ** 1.5`.
  `n < 3` raises `DomainError`; `m2 <= 0` raises `DomainError`.

`mean` and `stdev` are already written and must keep working.

**Accuracy requirement.** For a sample of finite doubles, `moments_of(...).m2` and every
`variance(...)` must agree with the exact rational value of the same quantity to within a relative
error of `1e-9`, and `m3` and `skewness(...)` to within a relative error of `1e-6` — including on
samples whose values sit around `1e9` while their spread is of order `1`. The same tolerances apply
to a state assembled by merging, at any split point, and the merge must be associative to within
them.

---

## 3. `numerics/quantiles.py` — exact order statistics

Two routines are missing. Both must do their positional arithmetic exactly, with
`fractions.Fraction`, and convert to `float` exactly once, at the very end. A float cumulative
weight or a float rank drifts, and the drift shows up as a non-monotone percentile curve.

### `quantile(values, p, method="linear")`

1. Reject an unknown `method` with `DomainError`. The accepted methods are exactly the five in
   `METHODS`: `"linear"`, `"lower"`, `"higher"`, `"nearest"`, `"midpoint"`. The comparison is
   case-sensitive.
2. Convert every element of `values` to `float`; a non-finite element raises `DomainError`. An
   empty `values` raises `EmptyInputError`. Sort ascending.
3. Convert `p` to `float`; if it is NaN or lies outside `[0, 1]` raise `DomainError`. Then take it
   as the exact rational that double denotes.
4. If `n == 1` the single observation is the answer for every `p` and every method.
5. Otherwise let `h = (n - 1) * p` **as an exact rational**, with `lo = floor(h)` and
   `hi = ceil(h)`.
   - `"lower"` returns `x[lo]`; `"higher"` returns `x[hi]`.
   - `"nearest"` returns `x[i]` where `i` is `h` rounded to an integer, halfway cases going to the
     **even** index (so with `n = 5`, `p = 0.375` gives `h = 1.5` and index `2`, and `p = 0.625`
     gives `h = 2.5` and index `2` as well).
   - `"midpoint"` returns the exact rational average of `x[lo]` and `x[hi]`, converted to float.
   - `"linear"` returns `x[lo] + (h - lo) * (x[hi] - x[lo])` computed as an exact rational and
     converted to float once. When `h` is an integer this is exactly `x[lo]`.

The result is always a `float` and never lies outside `[min(values), max(values)]`, and it is
non-decreasing in `p` for a fixed sample and method.

### `weighted_quantile(values, weights, p)`

Validation, in this order: `values` are converted to float and a non-finite one raises
`DomainError`; an empty `values` raises `EmptyInputError`; a `weights` of a different length raises
`DomainError`; a weight that is not finite and strictly positive raises `DomainError`; a `p` that
is NaN or outside `[0, 1]` raises `DomainError`.

Then, working entirely in exact rationals:

- Sort the (value, weight) pairs ascending by value.
- Let `S[k] = w[0] + ... + w[k]` be the cumulative weights of the sorted pairs and `W = S[n - 1]`.
- Anchor observation `k` at the plotting position `c[k] = (S[k] - w[k] / 2) / W`, the midpoint of
  the weight interval that observation occupies.
- If `p <= c[0]` the answer is the smallest observation; if `p >= c[n - 1]` it is the largest.
- Otherwise find the consecutive pair with `c[k] <= p <= c[k + 1]` and return
  `x[k] + (p - c[k]) / (c[k + 1] - c[k]) * (x[k + 1] - x[k])`, exact throughout, converted to float
  once. If `c[k + 1] == c[k]`, return `x[k + 1]`.

The answer must not depend on the order the pairs were supplied in, and must be non-decreasing in
`p`.

---

## Done when

`quantiles`, `median`, `mean` and `stdev` already delegate to the routines above and must keep
working, as must `numerics/histogram.py`, which is built on `summation` and `moments`. The whole
suite under `tests/` must pass.
