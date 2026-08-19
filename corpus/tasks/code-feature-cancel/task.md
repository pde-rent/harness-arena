# Add task cancellation to the scheduler

This repository is `taskq`, a dependency-aware, deterministic task queue written in TypeScript. Its
test suite currently passes. The `TaskState` union in `src/types.ts` already lists `"cancelled"`, and
`TERMINAL_STATES`, `StateCounts` and the snapshot format already account for it — but nothing in the
codebase ever produces that state, and there is no way to cancel a task.

Implement cancellation.

## Public API

Add exactly one new public method to the `Scheduler` class in `src/scheduler.ts`:

```ts
cancel(id: string): boolean
```

It returns `true` if and only if the task named by `id` itself transitioned into the `"cancelled"`
state as a result of this call. In every other case it returns `false`. Cancelling other tasks by
cascade (see below) never changes the return value.

No other public name, signature or behaviour may change. `createScheduler`, the exports in
`src/index.ts`, and the semantics of every existing method must stay exactly as they are.

## Which states may be cancelled

`cancel(id)` transitions the named task to `"cancelled"` if and only if its current state is
`"pending"` or `"ready"`.

Every other case is a **no-op**: the call returns `false` and nothing anywhere in the scheduler
changes — no task changes state, no task is removed from the ready queue, no plugin hook fires.
Specifically:

- state `"running"` → no-op, returns `false`. Execution is synchronous and is never interrupted; a
  handler that calls `cancel` on its own task id gets `false` and the task still settles normally.
- state `"done"` → no-op, returns `false`.
- state `"failed"` → no-op, returns `false`.
- state `"cancelled"` (already cancelled) → no-op, returns `false`.
- an id that no task has → no-op, returns `false`. It must **not** throw.

## Cascade

When `cancel(id)` does transition the named task, it must also transition **every task that
transitively depends on it** — every downstream task reachable through the dependency edges, not
merely the direct dependents — into `"cancelled"`, unless that task is already in a terminal state
(`"done"`, `"failed"` or `"cancelled"`), in which case it is left exactly as it is.

Cascaded tasks are cancelled, never failed: they must not end up in state `"failed"`, must not be
counted as failures, and their `error` field must not be set by cancellation. Cancellation never
writes to `error`; a task whose `error` was `null` still has `null` afterwards.

For every task that this call transitions (the named one and every cascaded one) the `finishedAt`
field is set to the scheduler's current clock time.

## Guarantees after a cancellation

For a task in state `"cancelled"`:

- It never runs. `tick()` and `runAll()` never start it, so its handler is never invoked and its
  `attempts` count never increases past whatever it already was.
- It never retries and is never re-promoted to `"ready"` or `"pending"`.
- It is not in `readyOrder()` and not in `pendingOrder()`.
- `counts().cancelled` includes it, and `byState("cancelled")` returns it. It is not included in
  `counts().pending`, `counts().ready`, `counts().running`, `counts().done` or `counts().failed`.
- It does not stop the queue from draining: once every task is in a terminal state, `isDrained()`
  returns `true`, and `runAll()` returns rather than spinning or blocking on the cancelled task.
- `tasks()`, `get(id)` and `require(id)` still return it, with `state === "cancelled"`.

Tasks that do not depend on the cancelled task are unaffected and still run normally.

## Snapshot / restore

`snapshot()` and `restore()` (and `Scheduler.fromSnapshot`) must round-trip cancelled tasks: after
restoring a snapshot taken while some tasks were cancelled, those tasks are still in state
`"cancelled"`, `counts()` is identical to before, no cancelled task is back in `readyOrder()`, and
`isDrained()` reports the same value as before the snapshot.

## Plugin hooks

Cancellation is silent: `cancel()` fires **no** plugin hook. Neither the named task nor any cascaded
task produces an `onEnqueue`, `onStart`, `onComplete` or `onFail` event, at the moment of
cancellation or ever afterwards.

## Constraints

- The existing test suite must still pass unchanged; the existing failure-cascade behaviour
  (`failDependentsOnFailure`, `cascadeFailure`, the `cascaded` field of `TickOutcome`) keeps working
  exactly as it does today.
- Everything stays deterministic: no wall-clock reads, no randomness beyond the injected `Rng`, no
  I/O, no new dependencies.
- Behaviour for tasks enqueued *after* a cancellation that declare a dependency on an
  already-cancelled task is out of scope and is left as it is today.
