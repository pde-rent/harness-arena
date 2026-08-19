#!/usr/bin/env python3
"""Recompute every expected number in expected.json straight from the fixture.

Run:  python3 solution/recompute.py [path-to-fixture]
It parses the constants out of the Go sources rather than hard-coding them, so
a change to the fixture shows up here as a mismatch.
"""
import json, math, os, re, sys
from decimal import Decimal, ROUND_HALF_UP

FIX = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "fixtures", "geosvc")
FIX = os.path.abspath(FIX)

def read(p):
    with open(os.path.join(FIX, p)) as f:
        return f.read()

defaults = read("config/defaults.go")

def region_field(name):
    return float(re.search(r"%s:\s*(-?[\d.]+)" % name, defaults).group(1))

region = {k: region_field(k) for k in ("MinLat", "MinLon", "MaxLat", "MaxLon")}
zoom = int(re.search(r"Zoom:\s*(\d+)", defaults).group(1))
features_per_tile = int(re.search(r"FeaturesPerTile:\s*(\d+)", defaults).group(1))
tile_budget = eval(re.search(r"TileBudgetBytes:\s*([^,]+),", defaults).group(1))

def go_const(path, name):
    return int(re.search(r"const %s = (\d+)" % name, read(path)).group(1))

fanout = go_const("index/rtree.go", "RTreeMaxEntries")
node_bytes = go_const("index/rtree.go", "NodeResidentBytes")
feature_bytes = go_const("store/feature.go", "FeatureIndexBytes")
envelope_bytes = go_const("index/tilecache.go", "TileEnvelopeBytes")

# --- 1. tiles covering the region at the default zoom (inclusive rectangle) ---
def slippy(lat, lon, z):
    n = 2 ** z
    x = math.floor((lon + 180) / 360 * n)
    r = math.radians(lat)
    y = math.floor((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    return x, y

nwx, nwy = slippy(region["MaxLat"], region["MinLon"], zoom)
sex, sey = slippy(region["MinLat"], region["MaxLon"], zoom)
tiles_covered = (sex - nwx + 1) * (sey - nwy + 1)

# --- 2..5. index sizing -------------------------------------------------------
features = tiles_covered * features_per_tile
ceil_div = lambda a, b: -(-a // b)
leaves = ceil_div(features, fanout)
total_nodes, level = leaves, leaves
while level > 1:
    level = ceil_div(level, fanout)
    total_nodes += level
resident = features * feature_bytes + total_nodes * node_bytes

# --- 6. tile cache capacity ---------------------------------------------------
per_tile = features_per_tile * feature_bytes + envelope_bytes
capacity = tile_budget // per_tile

# --- 7..8. workload -----------------------------------------------------------
wl = json.loads(read("testdata/workload.json"))
counts = sorted(wl["requestsByTile"].values(), reverse=True)
assert len(set(counts)) == len(counts), "workload has ties; the resident set would be ambiguous"
total_requests = sum(counts)
resident_counts = counts[:capacity]
hits = sum(resident_counts) - len(resident_counts)
misses = total_requests - hits
hit_rate = float(Decimal(hits) / Decimal(total_requests))
hit_rate = float(Decimal(hits).__truediv__(Decimal(total_requests)).quantize(
    Decimal("0.0001"), rounding=ROUND_HALF_UP))
minutes = Decimal(wl["windowSeconds"]) / Decimal(60)
reads_per_minute = math.ceil(Decimal(misses) / minutes)

computed = {
    "tilesCovered": tiles_covered,
    "featuresIndexed": features,
    "leafNodes": leaves,
    "totalIndexNodes": total_nodes,
    "residentIndexBytes": resident,
    "tileCacheCapacity": capacity,
    "cacheHitRate": hit_rate,
    "backingReadsPerMinute": reads_per_minute,
}

expected_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "expected.json")
with open(expected_path) as f:
    expected = json.load(f)
expected.pop("$ordered", None)

print(json.dumps(computed, indent=2))
if computed != expected:
    print("MISMATCH against expected.json:", file=sys.stderr)
    for k in sorted(set(computed) | set(expected)):
        if computed.get(k) != expected.get(k):
            print("  %s: computed %r, expected %r" % (k, computed.get(k), expected.get(k)), file=sys.stderr)
    sys.exit(1)
print("recompute matches expected.json", file=sys.stderr)
