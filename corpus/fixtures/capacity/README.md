# capacity

Capacity planner for the metrics-ingest tier.

The ingest tier accepts telemetry events over HTTP, compresses them on the
collector, batches the compressed events, writes each batch to a shard, and keeps
the result in a replicated hot tier for a contractual number of days. This package
turns a day of measured traffic plus the deployment's configuration into the
sizing and the monthly invoice that traffic implies.

Standard library only, Python 3.11 or newer. No network access, no clock reads,
no randomness: given the same inputs it always produces the same plan.

## Layout

```
capacity/config.py      built-in defaults, per-environment overrides, validation
capacity/rates.py       reading data/ingest_rates.csv and summarising it
capacity/ingest.py      event rate -> post-compression byte rate
capacity/batching.py    how many events fit in a batch, batches per second
capacity/sharding.py    how many shards the two per-shard ceilings demand
capacity/retention.py   how much the hot tier physically holds
capacity/pricing.py     tiered storage charge, free allowance, shard charge
capacity/rollup.py      the end-to-end plan
conf/<environment>.toml the fields a deployment changes; everything else defaults
data/ingest_rates.csv   one measured day of traffic, per hour and per fleet
```

## Configuration layering

`capacity.config.DEFAULTS` describes a small development deployment and is the
starting point for every environment. `load_config()` then reads
`conf/<environment>.toml`, where the environment is `capacity.config.ACTIVE_ENVIRONMENT`,
and applies **only** the fields that file actually sets. A field absent from the
environment file keeps its default. Files for environments other than the active
one are kept in the repository for reference and have no effect.

## Units

Getting these wrong is the most common way to misplan a fleet, so the package is
strict about them:

* `data/ingest_rates.csv` counts events and bytes **per clock hour**, not per
  second. There are 3600 seconds in an hour.
* `payload_bytes` in the data is the **uncompressed** payload. Everything
  downstream of `capacity/ingest.py` is post-compression.
* `batch_max_kib` is kibibytes: 1 KiB = 1024 bytes.
* `shard_max_mib_per_second` is mebibytes per second: 1 MiB = 1048576 bytes.
* Storage is billed per gibibyte: 1 GiB = 1073741824 bytes.

## Fleets

Rows in `data/ingest_rates.csv` are labelled with the fleet that produced them.
Only the fleet named by `billable_fleet` is real customer traffic. The `loadtest`
fleet is synthetic replay traffic produced by the load harness; it shares the
brokers but is never sized or billed for, and it regularly out-peaks production.

## Tests

```
python3 -m unittest discover -s tests -t . -p '*_test.py'
```
