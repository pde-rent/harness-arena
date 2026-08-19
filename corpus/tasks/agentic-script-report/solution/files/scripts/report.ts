import { ManualClock } from "../src/clock";
import { recordingPlugin } from "../src/plugins";
import { Scheduler } from "../src/scheduler";
import type { QueueOptions, TaskContext, TaskHandler, TaskOutcome } from "../src/types";

const hookSequence: string[] = [];

const handlers: Record<string, TaskHandler> = {
  ok: (ctx: TaskContext): TaskOutcome => ({ ok: true, value: `${ctx.task.id}:ok` }),
  flaky: (ctx: TaskContext): TaskOutcome =>
    ctx.attempt < 3
      ? { ok: false, error: `flaky attempt ${ctx.attempt}` }
      : { ok: true, value: ctx.now },
  boom: (_ctx: TaskContext): TaskOutcome => ({ ok: false, error: "boom" }),
};

function makeOptions(clock: ManualClock, sink: string[]): QueueOptions {
  return {
    clock,
    seed: 12345,
    handlers: { ...handlers },
    plugins: [recordingPlugin("audit", sink, 0)],
    defaultPriority: 0,
    defaultMaxAttempts: 1,
    backoff: { baseDelayMs: 500, factor: 3, maxDelayMs: 10000, jitter: true },
    failDependentsOnFailure: true,
  };
}

const clock = new ManualClock(1000);
const scheduler = new Scheduler(makeOptions(clock, hookSequence));

scheduler.enqueueAll([
  { id: "a", priority: 5, handler: "ok", maxAttempts: 1 },
  { id: "b", priority: 1, deps: ["a"], handler: "flaky", maxAttempts: 3 },
  { id: "c", priority: 1, deps: ["b"], handler: "ok", maxAttempts: 1 },
  { id: "d", priority: 9, handler: "boom", maxAttempts: 2 },
  { id: "e", priority: 0, deps: ["d"], handler: "ok", maxAttempts: 1 },
  { id: "f", priority: 7, payload: { n: 42 }, maxAttempts: 1 },
]);

const outcomes = scheduler.runAll({ maxSteps: 200, advanceClock: true });

const executionOrder = outcomes
  .filter((o) => o.kind === "ran")
  .map((o) => (o as { taskId: string }).taskId);

const ids = ["a", "b", "c", "d", "e", "f"];
const tasks: Record<string, unknown> = {};
for (const id of ids) {
  const t = scheduler.require(id);
  tasks[id] = {
    state: t.state,
    attempts: t.attempts,
    result: t.result,
    error: t.error,
    startedAt: t.startedAt,
    finishedAt: t.finishedAt,
  };
}

const snapshot = scheduler.snapshot();
const wire = JSON.parse(JSON.stringify(snapshot)) as unknown;
const restored = Scheduler.fromSnapshot(wire, makeOptions(new ManualClock(0), []));

const report = {
  finalTime: scheduler.now,
  ticks: outcomes.length,
  ranCount: executionOrder.length,
  idleCount: outcomes.filter((o) => o.kind === "idle").length,
  executionOrder,
  counts: scheduler.counts(),
  tasks,
  hookSequence,
  pluginNames: scheduler.pluginNames(),
  pluginErrorCount: scheduler.pluginErrors().length,
  drained: scheduler.isDrained(),
  topoOrder: scheduler.topoOrder(),
  snapshot: {
    version: snapshot.version,
    time: snapshot.time,
    seq: snapshot.seq,
    rngState: snapshot.rngState,
    taskCount: snapshot.tasks.length,
    edgeCount: snapshot.edges.length,
  },
  restored: {
    now: restored.now,
    counts: restored.counts(),
    bAttempts: restored.require("b").attempts,
    bResult: restored.require("b").result,
    eError: restored.require("e").error,
    drained: restored.isDrained(),
  },
};

await Bun.write("report.json", JSON.stringify(report, null, 2) + "\n");
