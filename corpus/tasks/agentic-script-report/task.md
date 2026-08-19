# Scenario report script

This repository is an in-memory task queue: tasks with priorities and dependency edges, a
scheduler with retries and backoff, a plugin hook registry, and snapshot serialisation. Its clock
and its random number generator are both injectable, so a scenario can be replayed exactly.

Your job is to build a **reproducible scenario report**.

Create a file `scripts/report.ts` in this repository. It must be runnable from the repository root
with:

```
bun run scripts/report.ts
```

Running it executes the scenario described below against this repository's own library code (do
not reimplement the scheduling logic) and writes the file `report.json` into the repository root.

The script must be re-runnable: running it any number of times, from a clean checkout, must
produce byte-identical `report.json` content. It must not read `report.json`, and it must not
require `report.json` to already exist. It must not read the wall clock, the date, the network, the
environment, or any global random source.

## The scenario

**Clock.** One manual clock, starting at time `1000`. The scheduler advances it; do not advance it
yourself.

**Scheduler options.** Exactly:

- `seed`: `12345`
- `defaultPriority`: `0`
- `defaultMaxAttempts`: `1`
- `backoff`: `baseDelayMs` `500`, `factor` `3`, `maxDelayMs` `10000`, `jitter` **enabled**
- `failDependentsOnFailure`: `true`
- one plugin: the library's own recording plugin, named `audit`, with order `0`, appending into an
  array you own (call that array the *hook log*)

**Handlers.** Three named handlers are registered on the scheduler:

- `ok` — always succeeds, with the result value being the task's own id followed by `:ok`
  (for the task `a` that is the string `"a:ok"`).
- `flaky` — fails on its 1st and 2nd attempt, succeeds on its 3rd. The failure error message on
  attempt _n_ is the string `flaky attempt <n>` (e.g. `"flaky attempt 1"`). On success the result
  value is the number given as the current time when that attempt ran.
- `boom` — always fails with the error message `"boom"`.

Neither handler draws from the random source.

**Tasks.** Enqueued in exactly this order, in one batch, before anything runs. Anything not listed
is left at its default.

| id | priority | deps | handler | payload | maxAttempts |
|----|----------|------|---------|---------|-------------|
| `a` | 5 | — | `ok` | — | 1 |
| `b` | 1 | `a` | `flaky` | — | 3 |
| `c` | 1 | `b` | `ok` | — | 1 |
| `d` | 9 | — | `boom` | — | 2 |
| `e` | 0 | `d` | `ok` | — | 1 |
| `f` | 7 | — | *(none)* | `{"n": 42}` | 1 |

`f` has no handler at all, so it takes the library's no-handler path.

**Run.** After enqueueing, run the whole queue to completion in one call, with a step ceiling of
`200` and with clock advancement enabled. Collect the sequence of per-step outcomes that call
returns; call that sequence the *outcome list*.

**Snapshot round-trip.** After the run finishes:

1. Take a snapshot of the scheduler.
2. Serialise it to JSON text and parse it back, so only plain JSON data survives.
3. Build a *second* scheduler from that parsed value, using the same options as above except that
   its clock is a fresh manual clock starting at time `0` and its plugin's hook log is a separate
   array (nothing from the second scheduler is reported into `hookSequence`).
4. Report values read back off that second scheduler.

## The artifact

`report.json` must be a JSON object with exactly these keys and no others.

```json
{
  "finalTime": 0,
  "ticks": 0,
  "ranCount": 0,
  "idleCount": 0,
  "executionOrder": [],
  "counts": { "pending": 0, "ready": 0, "running": 0, "done": 0, "failed": 0, "cancelled": 0 },
  "tasks": {},
  "hookSequence": [],
  "pluginNames": [],
  "pluginErrorCount": 0,
  "drained": false,
  "topoOrder": [],
  "snapshot": { "version": 0, "time": 0, "seq": 0, "rngState": 0, "taskCount": 0, "edgeCount": 0 },
  "restored": {
    "now": 0,
    "counts": { "pending": 0, "ready": 0, "running": 0, "done": 0, "failed": 0, "cancelled": 0 },
    "bAttempts": 0,
    "bResult": null,
    "eError": null,
    "drained": false
  }
}
```

Meanings:

- `finalTime` — the first scheduler's current time after the run.
- `ticks` — the number of entries in the outcome list.
- `ranCount` — how many of those entries report that a task actually ran.
- `idleCount` — how many of those entries report an idle step.
- `executionOrder` — the ids of the tasks that ran, one entry per run entry of the outcome list, in
  the order they ran. A task that runs more than once appears more than once. **Order matters.**
- `counts` — the first scheduler's per-state task counts after the run, all six states present.
- `tasks` — an object keyed by task id, containing **all six** ids `a`…`f`. Each value is an object
  with exactly the keys `state`, `attempts`, `result`, `error`, `startedAt`, `finishedAt`, taken
  verbatim from the final stored task (unset numbers and unset errors are `null`, not omitted).
- `hookSequence` — the first scheduler's hook log, exactly as the recording plugin wrote it,
  including the enqueue entries. **Order matters.**
- `pluginNames` — the first scheduler's registered plugin names.
- `pluginErrorCount` — how many plugin hook errors the first scheduler recorded.
- `drained` — whether every task of the first scheduler is in a terminal state.
- `topoOrder` — the first scheduler's topological ordering of the dependency graph. **Order
  matters.**
- `snapshot` — from the snapshot taken in step 1: its format `version`, `time`, `seq`, `rngState`,
  plus `taskCount` (number of tasks it carries) and `edgeCount` (number of dependency edges it
  carries).
- `restored` — read off the *second* scheduler built in step 3: its current time as `now`, its
  per-state `counts`, task `b`'s attempt count as `bAttempts`, task `b`'s result as `bResult`, task
  `e`'s error string as `eError`, and whether it is fully drained as `drained`.

Do not hand-write these values. The report is checked by running your script and comparing the file
it produces, so every number and string in it has to come out of an actual run of the scheduler.

The repository's existing test suite must still pass unchanged.
