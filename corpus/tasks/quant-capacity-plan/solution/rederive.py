"""Independent re-derivation of expected.json.

Reads the fixture's raw CSV and TOML directly; deliberately does NOT import the
`capacity` package, so it is a genuine second opinion on the arithmetic.
Run:  python3 solution/rederive.py <path-to-fixtures/capacity>
"""
import csv, math, sys, tomllib
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "../../fixtures/capacity")

# --- defaults, transcribed by hand from capacity/config.py -------------------
D = dict(
    billable_fleet="prod", compression_ratio=2.0, batch_max_kib=250, batch_max_events=500,
    shard_max_events_per_second=4000, shard_max_mib_per_second=1.0,
    retention_days=7, replication_factor=1, hot_tier_free_gib=1000,
    price_tiers=[(10000, "0.021"), (40000, "0.017"), (None, "0.012")],
    shard_monthly_usd="45.00", monthly_budget_usd="700.00",
)
ACTIVE = "prod"                       # capacity/config.py ACTIVE_ENVIRONMENT
env_path = f"conf/{ACTIVE}.toml"
ov = tomllib.loads((root / env_path).read_text())
cfg = {**D, **ov}

# --- measured rates ----------------------------------------------------------
rows = [r for r in csv.DictReader((root / "data/ingest_rates.csv").open())
        if r["fleet"] == cfg["billable_fleet"]]
ev = [int(r["events"]) for r in rows]
pb = [int(r["payload_bytes"]) for r in rows]

peak_eps = math.ceil(max(ev) / 3600)                                   # 1
avg = math.ceil(sum(pb) / sum(ev))                                     # 2
cbps = math.ceil(peak_eps * avg / cfg["compression_ratio"])            # 3

per_event = avg / cfg["compression_ratio"]
limit = cfg["batch_max_kib"] * 1024
epb = min(math.ceil(limit / per_event), cfg["batch_max_events"])       # 4  (>= threshold)
bps = math.ceil(peak_eps / epb)                                        # 5

by_ev = math.ceil(peak_eps / cfg["shard_max_events_per_second"])
by_by = math.ceil(cbps / int(cfg["shard_max_mib_per_second"] * 1024 * 1024))
shards = max(by_ev, by_by)                                             # 6
binding = "shard_max_events_per_second" if by_ev >= by_by else "shard_max_mib_per_second"

daily = math.ceil(sum(ev) * avg / cfg["compression_ratio"])

def invoice(retention_days):
    window = retention_days + 1
    hot = daily * window * cfg["replication_factor"]
    gib = math.ceil(hot / (1024 ** 3))
    rem = max(0, gib - cfg["hot_tier_free_gib"])
    total = Decimal(0)
    for size, rate in cfg["price_tiers"]:
        if rem <= 0:
            break
        take = rem if size is None else min(rem, size)
        total += Decimal(take) * Decimal(rate)
        rem -= take
    total += Decimal(shards) * Decimal(cfg["shard_monthly_usd"])
    return window, hot, gib, total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

window, hot, gib, cost = invoice(cfg["retention_days"])                # 7,8,9,10

budget = Decimal(cfg["monthly_budget_usd"])
best = max(d for d in range(0, 4000) if invoice(d)[3] <= budget)       # 11

print({
    "envConfigPath": env_path,
    "envOverriddenFields": sorted(ov),
    "peakEventsPerSecond": peak_eps,
    "avgPayloadBytes": avg,
    "compressedPeakBytesPerSecond": cbps,
    "eventsPerBatch": epb,
    "batchesPerSecond": bps,
    "shardsRequired": shards,
    "bindingShardLimitField": binding,
    "retentionWindowDays": window,
    "hotTierBytes": hot,
    "hotTierGib": gib,
    "monthlyCostUsd": float(cost),
    "maxRetentionDaysWithinBudget": best,
})
