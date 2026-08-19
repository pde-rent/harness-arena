# Implement the exact integer allocation routines

This repository is `numerics`, a dependency-free Python library of aggregation primitives for a
telemetry pipeline. Two routines in `numerics/allocate.py` have been removed and replaced with
`raise NotImplementedError`. The test suite is red as a result, and so is `numerics/rounding.py`,
whose `distribute_decimal` is layered on one of them.

Implement the two routines to the spec below. Everything is graded on behaviour.

## Ground rules

- Python 3.11 or newer, standard library only. `math`, `fractions`, `decimal`, `itertools`,
  `dataclasses` and `typing` are available. No third-party packages.
- No network, no clock, no randomness. Both routines must be pure functions of their arguments.
- **No floating point may appear anywhere in the decision path.** Weights, quotas, remainders and
  penalties are compared as exact rationals. A `float` input denotes exactly the binary value it
  holds, and `numerics.allocate.to_exact` (already written) converts anything acceptable —
  `int`, `float`, `Fraction`, `Decimal` — to that exact `Fraction` with no rounding. Converting to
  `float` for a comparison, even briefly, changes answers on the graded inputs.
- Do not change any exported name or signature, and do not weaken, delete or skip any existing
  test. You may add code and add tests.
- Exceptions come from `numerics.errors`: `DomainError` for an argument outside the accepted
  domain, `AllocationError` when the constraints cannot be satisfied at all.
- `to_exact`, `is_convex` and `allocation_cost` are already written; leave them as they are and use
  them.

---

## 1. `largest_remainder(weights, total) -> list[int]`

Hamilton apportionment: hand out `total` indivisible units in proportion to `weights`, so that the
returned list sums to `total` **exactly**, always.

Validation, in this order:

- `total` must be an `int` (a `bool` is not an `int` for this purpose, and neither is `2.0`);
  otherwise `DomainError`.
- `total` must not be negative; otherwise `DomainError`.
- No weight may be negative; otherwise `DomainError`.
- If `weights` is empty: return `[]` when `total == 0`, otherwise `AllocationError`.
- If the weights sum to zero: return a list of zeros when `total == 0`, otherwise
  `AllocationError`.

Then, in exact rational arithmetic:

1. Let `W` be the sum of the weights and `q[i] = weights[i] * total / W` the exact quota of bucket
   `i`.
2. Bucket `i` first receives `base[i] = floor(q[i])`.
3. Let `r = total - sum(base)`; this is how many units are still unassigned, and it is always
   between `0` and `len(weights) - 1`.
4. Rank the buckets by, in order: **larger fractional remainder** `q[i] - base[i]` first; then
   **larger quota** `q[i]` first; then **lower index** first. Give one extra unit to each of the
   first `r` buckets in that ranking.

The second key matters. With `weights = [1, 3]` and `total = 2` the quotas are `1/2` and `3/2`, the
remainders tie at exactly `1/2`, and the single spare unit goes to bucket `1`, giving `[0, 2]`.
With `weights = [1, 1, 1, 1]` and `total = 6` the quotas all equal `3/2`, remainders and quotas all
tie, and the two spare units go to the two lowest indices, giving `[2, 2, 1, 1]`.

Every element of the result is a plain non-negative `int`, a bucket of weight zero always receives
`0`, and each bucket's share differs from its exact quota by strictly less than one unit.

---

## 2. `min_penalty_allocation(units, costs) -> tuple[Fraction, list[int]]`

`costs[i]` is bucket `i`'s penalty row: `costs[i][k]` is the penalty incurred when bucket `i`
receives exactly `k` units. The row therefore also states the bucket's capacity — bucket `i` may
hold any integer from `0` to `len(costs[i]) - 1` units. Rows may have different lengths, entries
need not be sorted, need not start at zero, and need not be non-negative.

Choose an allocation `a` with `0 <= a[i] <= len(costs[i]) - 1` for every `i` and
`sum(a) == units` exactly, minimising `sum(costs[i][a[i]])`.

Return `(cost, allocation)` where `cost` is the exact minimum as a `fractions.Fraction` and
`allocation` is a list of plain `int`s. `cost` must equal `allocation_cost(costs, allocation)`.

**Tie-break.** Several allocations can achieve the minimum. Return the one whose tuple
`(a[0], a[1], ..., a[n-1])` is **lexicographically smallest** — compare `a[0]` first, and only on a
tie move to `a[1]`, and so on, smaller being preferred. This is a property of the reconstruction
order, not of the cost: the answer is determined bucket by bucket from index `0` upwards, taking at
each step the smallest number of units that still leaves an optimal completion for the remaining
buckets and units.

**Why the obvious approach is wrong.** Handing out units one at a time to whichever bucket has the
cheapest next marginal penalty is optimal only when every row is discretely convex, i.e. when
`is_convex(row)` holds for all of them — its exchange argument needs the marginal penalties of each
bucket to be non-decreasing. Rows here are arbitrary data and are frequently not convex, and on
such rows the marginal heuristic silently returns a strictly worse allocation. For example, with
`units = 2` and `costs = [[0, 10, 1], [0, 4, 8]]` the marginal rule puts both units in bucket `1`
for a penalty of `8`, while the optimum is `1`, attained by `[2, 0]`. Even when the marginal rule
happens to reach the optimal cost it can land on an allocation that is not the lexicographically
smallest optimum, which is also wrong.

Validation, in this order:

- `units` must be an `int` (again, not a `bool`, not `2.0`); otherwise `DomainError`.
- `units` must not be negative; otherwise `DomainError`.
- Every row must be non-empty; otherwise `DomainError`.
- If `costs` is empty: return `(Fraction(0), [])` when `units == 0`, otherwise `AllocationError`.
- If the total capacity `sum(len(row) - 1 for row in costs)` is less than `units`:
  `AllocationError`.

`min_penalty_allocation(0, costs)` is `(Fraction(0) + sum of every row's entry at index 0,
[0, 0, ...])` — that is, the all-zero allocation, whose cost is whatever the rows charge for
holding nothing.

---

## Done when

The whole suite under `tests/` passes, including `tests/rounding_test.py`, whose
`distribute_decimal` scales a `Decimal` amount to whole units of `10 ** -places`, apportions it with
`largest_remainder`, and scales back — so it only adds up exactly if the apportionment does.
