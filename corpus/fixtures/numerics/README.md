# numerics

Numerically careful aggregation primitives for a telemetry pipeline.

Ingested samples are summarised at the edge, shipped as partial states, and merged centrally.
That shape imposes three constraints on every routine in here:

1. **Mergeable.** A summary computed over shard A and a summary computed over shard B must combine
   into the summary the two shards would have produced together. Anything that can only be computed
   from the full sample is useless.
2. **Reproducible.** The same inputs must give the same bytes on every machine and every release.
   Anything positional — quantile ranks, apportionment remainders, rounding ties — is computed in
   exact rational or decimal arithmetic and rounded exactly once, at the very end.
3. **Honest about floating point.** Telemetry mixes magnitudes: a counter at 1e12 receiving 1e-3
   deltas, a gauge oscillating around 1e9. Naive accumulation destroys the answer long before the
   sample is large. Summation is compensated; moments are centred.

## Modules

| module | contents |
|---|---|
| `numerics/summation.py` | compensated summation, partial-sum states, running totals |
| `numerics/moments.py` | streaming mean / variance / skewness with a pairwise merge |
| `numerics/quantiles.py` | order statistics, five interpolation rules, weighted quantiles |
| `numerics/histogram.py` | log-linear bucketing of long-tailed distributions |
| `numerics/intervals.py` | half-open interval algebra over exact rationals |
| `numerics/allocate.py` | integer apportionment and minimum-penalty unit placement |
| `numerics/rounding.py` | decimal rounding rules and total-preserving splits |
| `numerics/errors.py` | the shared exception hierarchy |

## Requirements

Python 3.11 or newer. No third-party packages, no network access, no clock and no randomness.

## Tests

```
python3 -m unittest discover -s tests -t . -p '*_test.py'
```
