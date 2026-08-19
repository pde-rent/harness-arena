# Size the prod ingest fleet and price it

This repository is a capacity planner for a metrics-ingest tier. It holds the planner's
configuration layering, one measured day of traffic, and the arithmetic that turns the two into a
sizing and a monthly invoice.

Work out, for the deployment the planner is currently configured to size, the chain of figures
below. Each step feeds the next: **every step must be computed from the rounded result of the
previous step**, not from an unrounded intermediate. All of it is determined by the repository's
configuration, data and documented rules — nothing here depends on when or where the work is done.

This is a read-only investigation. **Do not create, delete or modify any file in the repository**,
with the single exception of the answer file described below. The only artifact you may leave
behind is `answer.json` in the root of the repository.

## The answer file

Write `answer.json` at the root of this repository with exactly these fifteen keys and nothing
else:

```json
{
  "envConfigPath": "",
  "envOverriddenFields": [],
  "peakEventsPerSecond": 0,
  "avgPayloadBytes": 0,
  "compressedPeakBytesPerSecond": 0,
  "eventsPerBatch": 0,
  "batchesPerSecond": 0,
  "shardsRequired": 0,
  "bindingShardLimitField": "",
  "retentionWindowDays": 0,
  "hotTierBytes": 0,
  "hotTierGib": 0,
  "monthlyCostUsd": 0,
  "maxRetentionDaysWithinBudget": 0,
  "notes": ""
}
```

## What each key means, and exactly how to round it

Unless a key says otherwise, give a JSON number, not a string.

1. **`envConfigPath`** — the repository-relative path of the environment configuration file that
   is actually applied on top of the built-in defaults for the deployment being sized. Exactly one
   file. Other environment files exist and are not applied.

2. **`envOverriddenFields`** — the exact identifiers, spelled as they appear in that file, of
   every configuration field that file sets. A JSON array of strings; order does not matter.

3. **`peakEventsPerSecond`** — the sustained event rate, in events per second, of the busiest
   measured hour of billable traffic. Round **up** to a whole event per second.

4. **`avgPayloadBytes`** — the mean uncompressed payload of a single event across the whole
   measured day of billable traffic, weighted by event count. Round **up** to a whole byte.

5. **`compressedPeakBytesPerSecond`** — post-compression ingest throughput at the peak rate, in
   bytes per second. Round **up** to a whole byte per second.

6. **`eventsPerBatch`** — how many average events end up in one closed batch, given the batching
   limits that apply to this deployment and the documented rule for when a batch is closed. A
   whole number of events.

7. **`batchesPerSecond`** — closed batches produced per second at the peak rate. Round **up** to a
   whole batch per second.

8. **`shardsRequired`** — the number of shards the peak load needs. A whole number of shards.

9. **`bindingShardLimitField`** — the exact identifier of the configuration field whose per-shard
   ceiling is the one that decides that shard count. If both ceilings demand the same number of
   shards, name the events ceiling.

10. **`retentionWindowDays`** — the number of days of data physically resident in the hot tier
    once the retention window is full, for this deployment. A whole number of days.

11. **`hotTierBytes`** — total bytes occupied by the hot tier once that window is full, counting
    every replica, computed from the measured daily volume of billable traffic. Round **up** to a
    whole byte.

12. **`hotTierGib`** — the same quantity expressed in gibibytes, rounded **up** to a whole GiB.

13. **`monthlyCostUsd`** — the monthly invoice for that deployment: hot-tier storage plus
    provisioned shards, priced by the repository's tier table and its free allowance. Give a
    number in US dollars rounded to exactly **2 decimal places**, half away from zero
    (so `1.005` becomes `1.01`).

14. **`maxRetentionDaysWithinBudget`** — the largest whole number of retained history days for
    which the monthly invoice, computed exactly as in the previous key, still does **not exceed**
    the configured monthly budget. Everything else stays as it is: the same measured daily volume,
    the same replication factor, the same shard count from key 8, the same free allowance and tier
    table. A budget hit exactly is within budget. A whole number of days.

15. **`notes`** — free prose: a short account of where each figure came from. Not scored.

Give exact identifiers as they are spelled in the source, and repository-relative paths.
