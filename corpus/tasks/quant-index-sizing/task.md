# Size the index and the tile cache for a default deployment

This repository is a geospatial tile and feature service written in Go. An operator wants to know
what one process costs, and how much of the recorded traffic it can serve from memory, before any
of it is deployed.

Everything you need is committed here: the configuration defaults, the constants and doc comments
that state how much memory each thing occupies, the branching factor of the index, and one sample
workload under `testdata/`. Nothing depends on a running process, a clock, a network or a random
number.

## Constraints

- **Do not modify the repository.** Do not edit, add, delete, move or reformat any file that is
  already here. This is a read-only investigation, and the working tree is checked afterwards.
- The single artifact you produce is a file named `answer.json` in the root of the repository.
- Assume the process runs with the configuration the repository's defaults produce, unmodified.

## The chain to derive

Each step feeds the next, so an error early on carries all the way through.

1. **`tilesCovered`** — the number of tiles that cover the default index region at the default
   index zoom. Use the region exactly as configured, with no buffering applied to it, and count
   tiles the way this repository's coverage helper counts them: the rectangle of tile coordinates
   spanning the region's corners, inclusive at both ends on both axes. Integer.

2. **`featuresIndexed`** — the number of features the process indexes: every covered tile holds
   the configured planning figure for features per tile. Integer.

3. **`leafNodes`** — the number of leaf nodes a packed index tree needs to hold that many
   features, where every leaf is filled to the tree's branching-factor constant and only the last
   leaf may be partially filled. Integer.

4. **`totalIndexNodes`** — the total number of nodes in that packed tree, leaves included. Above
   the leaves, each level holds the number of nodes at the level below divided by the same
   branching-factor constant, rounded up, and levels are added until a level holds exactly one
   node, the root. Integer.

5. **`residentIndexBytes`** — the memory the built index occupies: every indexed feature costs the
   documented per-feature index size, and every node of the tree, leaves included, costs the
   documented per-node resident size. Nothing else counts. Integer.

6. **`tileCacheCapacity`** — how many whole tiles fit in the configured tile-cache byte budget.
   One cached tile costs the documented per-tile envelope overhead once, plus the documented
   per-feature index size for each of the features it holds; assume a cached tile holds the
   configured planning figure for features per tile. Divide the budget by that per-tile cost and
   round **down**. Integer.

7. **`cacheHitRate`** — the fraction of the recorded requests that the tile cache would serve,
   under this model:
   - The workload is the committed sample under `testdata/`. It records, for one window, how many
     requests each tile received.
   - The `tileCacheCapacity` most-requested tiles in the workload are resident for the whole
     window; every other tile is never resident. (No two tiles in the workload have the same
     request count, so this set is unambiguous.)
   - Every resident tile costs exactly one compulsory miss, on its first request; its remaining
     requests are hits.
   - Every request for a non-resident tile is a miss.
   - `cacheHitRate` is hits divided by the total number of recorded requests, **rounded half-up to
     four decimal places**.

8. **`backingReadsPerMinute`** — one miss costs one read from the backing store. Take the total
   number of misses over the workload's window, convert to a per-minute rate using the window
   length the workload file records, and round **up** to the next integer. Integer.

## The answer file

`answer.json` must be a JSON object with exactly these nine keys and no others:

```json
{
  "tilesCovered": 0,
  "featuresIndexed": 0,
  "leafNodes": 0,
  "totalIndexNodes": 0,
  "residentIndexBytes": 0,
  "tileCacheCapacity": 0,
  "cacheHitRate": 0.0,
  "backingReadsPerMinute": 0,
  "notes": "<free prose showing your working; not scored>"
}
```

Every numeric key must be a JSON number, not a string, and must carry no units. `cacheHitRate` is
a fraction between 0 and 1, not a percentage. `notes` is free prose and is not graded.
