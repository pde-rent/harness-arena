import { nextAvailableAt, shouldRetry } from "./backoff";
import { CycleError, DependencyGraph } from "./graph";
import { PluginRegistry, type PluginError } from "./plugins";
import { ReadyQueue, sortByPriority } from "./priority";
import { cascadeFailure, classifyPending, nextDeadline, promoteReady } from "./promote";
import { Lcg } from "./rng";
import {
  restoreState,
  snapshotState,
  type SchedulerSnapshot,
} from "./serialize";
import { TaskStore, UnknownTaskError } from "./store";
import {
  isTerminal,
  resolveOptions,
  type Plugin,
  type QueueOptions,
  type ResolvedQueueOptions,
  type StateCounts,
  type Task,
  type TaskHandler,
  type TaskOutcome,
  type TaskSpec,
  type TaskState,
  type TickOutcome,
} from "./types";

export interface RunAllOptions {
  maxSteps?: number;
  advanceClock?: boolean;
}

export class Scheduler {
  private readonly options: ResolvedQueueOptions;
  private readonly plugins = new PluginRegistry();
  private store = new TaskStore();
  private graph = new DependencyGraph();
  private queue = new ReadyQueue();
  private rng: Lcg;
  private seq = 0;

  constructor(options: QueueOptions) {
    this.options = resolveOptions(options);
    this.rng = new Lcg(this.options.seed);
    this.plugins.registerAll(options.plugins ?? []);
  }

  get now(): number {
    return this.options.clock.now();
  }

  get size(): number {
    return this.store.size;
  }

  use(plugin: Plugin): this {
    this.plugins.register(plugin);
    return this;
  }

  registerHandler(name: string, handler: TaskHandler): this {
    this.options.handlers[name] = handler;
    return this;
  }

  enqueue(spec: TaskSpec): Task {
    const now = this.now;
    const deps = [...new Set(spec.deps ?? [])];
    const task: Task = {
      id: spec.id,
      seq: this.seq,
      priority: spec.priority ?? this.options.defaultPriority,
      deps,
      handler: spec.handler ?? null,
      payload: spec.payload ?? null,
      state: "pending",
      attempts: 0,
      maxAttempts: spec.maxAttempts ?? this.options.defaultMaxAttempts,
      createdAt: now,
      availableAt: spec.availableAt ?? now,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };

    const stored = this.store.add(task);
    this.seq += 1;
    this.graph.addNode(task.id);
    try {
      for (const dep of deps) this.graph.addEdge(dep, task.id);
      if (this.graph.hasCycle()) {
        throw new CycleError(this.graph.detectCycles());
      }
    } catch (error) {
      this.rollback(task.id, deps);
      throw error;
    }

    this.plugins.emit("onEnqueue", { task: stored, at: now });
    return stored;
  }

  enqueueAll(specs: TaskSpec[]): Task[] {
    return specs.map((spec) => this.enqueue(spec));
  }

  tick(): TickOutcome {
    const now = this.now;
    promoteReady(this.store, this.graph, this.queue, now);
    this.reapDoomed(now);

    const entry = this.queue.pop();
    if (entry === null) {
      return { kind: "idle", at: now };
    }

    const started = this.store.update(entry.id, {
      state: "running",
      startedAt: now,
      attempts: this.store.require(entry.id).attempts + 1,
    });
    this.plugins.emit("onStart", {
      task: started,
      attempt: started.attempts,
      at: now,
    });

    const outcome = this.execute(started, now);
    return outcome.ok
      ? this.settleSuccess(started.id, outcome, now)
      : this.settleFailure(started.id, outcome.error, now);
  }

  runAll(options: RunAllOptions = {}): TickOutcome[] {
    const maxSteps = options.maxSteps ?? 1000;
    const advanceClock = options.advanceClock ?? true;
    const outcomes: TickOutcome[] = [];

    for (let step = 0; step < maxSteps; step += 1) {
      const outcome = this.tick();
      if (outcome.kind === "ran") {
        outcomes.push(outcome);
        continue;
      }
      if (!advanceClock || !this.advanceToNextDeadline()) {
        outcomes.push(outcome);
        break;
      }
    }
    return outcomes;
  }

  advanceToNextDeadline(): boolean {
    const clock = this.options.clock;
    if (typeof clock.advance !== "function") return false;
    const deadline = nextDeadline(this.store, this.graph, clock.now());
    if (deadline === null || deadline <= clock.now()) return false;
    clock.advance(deadline - clock.now());
    return true;
  }

  get(id: string): Task | undefined {
    return this.store.get(id);
  }

  require(id: string): Task {
    return this.store.require(id);
  }

  byState(state: TaskState): Task[] {
    return this.store.byState(state);
  }

  counts(): StateCounts {
    return this.store.counts();
  }

  tasks(): Task[] {
    return this.store.all();
  }

  readyOrder(): string[] {
    return this.queue.toSortedArray().map((entry) => entry.id);
  }

  pendingOrder(): string[] {
    return sortByPriority(this.store.byState("pending")).map((task) => task.id);
  }

  dependentsOf(id: string): string[] {
    if (!this.store.has(id)) throw new UnknownTaskError(id);
    return this.graph.dependentsOf(id);
  }

  topoOrder(): string[] {
    return this.graph.topoSort();
  }

  isDrained(): boolean {
    return this.store.all().every((task) => isTerminal(task.state));
  }

  isBlocked(): boolean {
    if (this.queue.size > 0) return false;
    const classified = classifyPending(this.store, this.graph, this.now);
    return classified.ready.length === 0 && classified.waiting.length === 0;
  }

  pluginErrors(): PluginError[] {
    return this.plugins.errors();
  }

  pluginNames(): string[] {
    return this.plugins.names();
  }

  snapshot(): SchedulerSnapshot {
    return snapshotState({
      store: this.store,
      graph: this.graph,
      time: this.now,
      seq: this.seq,
      rngState: this.rng.getState(),
    });
  }

  restore(snapshot: unknown): void {
    const core = restoreState(snapshot);
    this.store = core.store;
    this.graph = core.graph;
    this.queue = core.queue;
    this.seq = core.seq;
    this.rng.setState(core.rngState);
    const clock = this.options.clock;
    if (typeof clock.advance === "function" && core.time > clock.now()) {
      clock.advance(core.time - clock.now());
    }
  }

  static fromSnapshot(snapshot: unknown, options: QueueOptions): Scheduler {
    const scheduler = new Scheduler(options);
    scheduler.restore(snapshot);
    return scheduler;
  }

  private execute(task: Task, now: number): TaskOutcome {
    const handler = task.handler === null ? undefined : this.options.handlers[task.handler];
    if (task.handler !== null && handler === undefined) {
      return { ok: false, error: `missing handler: ${task.handler}` };
    }
    if (handler === undefined) {
      return { ok: true, value: task.payload };
    }
    try {
      return handler({
        task,
        attempt: task.attempts,
        now,
        random: () => this.rng.nextFloat(),
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private settleSuccess(
    id: string,
    outcome: { ok: true; value?: unknown },
    now: number,
  ): TickOutcome {
    const done = this.store.update(id, {
      state: "done",
      finishedAt: now,
      error: null,
      result: (outcome.value ?? null) as Task["result"],
    });
    this.plugins.emit("onComplete", { task: done, result: done.result, at: now });
    return {
      kind: "ran",
      at: now,
      taskId: id,
      state: done.state,
      attempt: done.attempts,
      willRetry: false,
      cascaded: [],
    };
  }

  private settleFailure(id: string, error: string, now: number): TickOutcome {
    const current = this.store.require(id);
    const retry = shouldRetry(current);
    const retryAt = retry
      ? nextAvailableAt(now, current.attempts, this.options.backoff, this.rng)
      : null;

    const settled = retry
      ? this.store.update(id, {
          state: "pending",
          error,
          startedAt: null,
          availableAt: retryAt as number,
        })
      : this.store.update(id, { state: "failed", error, finishedAt: now });

    this.plugins.emit("onFail", {
      task: settled,
      error,
      attempt: settled.attempts,
      willRetry: retry,
      retryAt,
      at: now,
    });

    const cascaded =
      !retry && this.options.failDependentsOnFailure
        ? cascadeFailure(this.store, this.graph, id, this.queue, now)
        : [];

    return {
      kind: "ran",
      at: now,
      taskId: id,
      state: settled.state,
      attempt: settled.attempts,
      willRetry: retry,
      cascaded,
    };
  }

  private reapDoomed(now: number): void {
    if (!this.options.failDependentsOnFailure) return;
    for (const task of classifyPending(this.store, this.graph, now).doomed) {
      const blocker = this.blockerOf(task);
      this.queue.remove(task.id);
      this.store.update(task.id, {
        state: "failed",
        error: `dependency failed: ${blocker}`,
        finishedAt: now,
      });
    }
  }

  private blockerOf(task: Task): string {
    for (const dep of task.deps) {
      const upstream = this.store.get(dep);
      if (upstream !== undefined && upstream.state !== "done" && isTerminal(upstream.state)) {
        return dep;
      }
    }
    return task.deps[0] ?? task.id;
  }

  private rollback(id: string, deps: string[]): void {
    for (const dep of deps) this.graph.removeEdge(dep, id);
    this.graph.removeNode(id);
    const remaining = this.store.all().filter((task) => task.id !== id);
    this.store.bulkLoad(remaining);
    this.queue.remove(id);
  }
}

export function createScheduler(options: QueueOptions): Scheduler {
  return new Scheduler(options);
}
