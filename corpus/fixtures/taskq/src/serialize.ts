import { DependencyGraph, type GraphEdge } from "./graph";
import { ReadyQueue, toEntry } from "./priority";
import { TaskStore } from "./store";
import type { JsonValue, Task, TaskState } from "./types";

export const SNAPSHOT_VERSION = 1;

const STATES: readonly TaskState[] = [
  "pending",
  "ready",
  "running",
  "done",
  "failed",
  "cancelled",
];

export interface SchedulerSnapshot {
  version: number;
  time: number;
  seq: number;
  rngState: number;
  nodes: string[];
  edges: GraphEdge[];
  tasks: Task[];
}

export interface SchedulerCore {
  store: TaskStore;
  graph: DependencyGraph;
  queue: ReadyQueue;
  time: number;
  seq: number;
  rngState: number;
}

export class SnapshotFormatError extends Error {
  constructor(message: string) {
    super(`invalid snapshot: ${message}`);
    this.name = "SnapshotFormatError";
  }
}

export function snapshotState(core: Omit<SchedulerCore, "queue">): SchedulerSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    time: core.time,
    seq: core.seq,
    rngState: core.rngState,
    nodes: core.graph.nodes(),
    edges: core.graph.edges().map((edge) => ({ from: edge.from, to: edge.to })),
    tasks: core.store.all().map(plainTask),
  };
}

export function restoreState(snapshot: unknown): SchedulerCore {
  const parsed = parseSnapshot(snapshot);
  const store = new TaskStore();
  store.bulkLoad(parsed.tasks.map(plainTask));

  const graph = new DependencyGraph();
  for (const node of parsed.nodes) graph.addNode(node);
  for (const edge of parsed.edges) graph.addEdge(edge.from, edge.to);

  const queue = new ReadyQueue();
  for (const task of store.byState("ready")) queue.push(toEntry(task));

  return {
    store,
    graph,
    queue,
    time: parsed.time,
    seq: parsed.seq,
    rngState: parsed.rngState,
  };
}

export function parseSnapshot(value: unknown): SchedulerSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new SnapshotFormatError("expected an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== SNAPSHOT_VERSION) {
    throw new SnapshotFormatError(`unsupported version ${String(raw.version)}`);
  }
  for (const key of ["time", "seq", "rngState"]) {
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key] as number)) {
      throw new SnapshotFormatError(`field ${key} must be a finite number`);
    }
  }
  if (!Array.isArray(raw.nodes) || !raw.nodes.every((n) => typeof n === "string")) {
    throw new SnapshotFormatError("nodes must be an array of strings");
  }
  if (!Array.isArray(raw.edges)) {
    throw new SnapshotFormatError("edges must be an array");
  }
  if (!Array.isArray(raw.tasks)) {
    throw new SnapshotFormatError("tasks must be an array");
  }
  return {
    version: SNAPSHOT_VERSION,
    time: raw.time as number,
    seq: raw.seq as number,
    rngState: raw.rngState as number,
    nodes: [...(raw.nodes as string[])],
    edges: (raw.edges as unknown[]).map(parseEdge),
    tasks: (raw.tasks as unknown[]).map(parseTask),
  };
}

export function isSnapshot(value: unknown): value is SchedulerSnapshot {
  try {
    parseSnapshot(value);
    return true;
  } catch {
    return false;
  }
}

export function toJson(snapshot: SchedulerSnapshot): string {
  return JSON.stringify(snapshot);
}

export function fromJson(text: string): SchedulerSnapshot {
  return parseSnapshot(JSON.parse(text) as unknown);
}

function parseEdge(value: unknown): GraphEdge {
  if (typeof value !== "object" || value === null) {
    throw new SnapshotFormatError("edge must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.from !== "string" || typeof raw.to !== "string") {
    throw new SnapshotFormatError("edge endpoints must be strings");
  }
  return { from: raw.from, to: raw.to };
}

function parseTask(value: unknown): Task {
  if (typeof value !== "object" || value === null) {
    throw new SnapshotFormatError("task must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string") {
    throw new SnapshotFormatError("task id must be a string");
  }
  if (typeof raw.state !== "string" || !STATES.includes(raw.state as TaskState)) {
    throw new SnapshotFormatError(`task ${raw.id} has an unknown state`);
  }
  if (!Array.isArray(raw.deps) || !raw.deps.every((d) => typeof d === "string")) {
    throw new SnapshotFormatError(`task ${raw.id} deps must be strings`);
  }
  return plainTask(raw as unknown as Task);
}

function plainTask(task: Task): Task {
  return {
    id: task.id,
    seq: task.seq,
    priority: task.priority,
    deps: [...task.deps],
    handler: task.handler ?? null,
    payload: cloneJson(task.payload),
    state: task.state,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    createdAt: task.createdAt,
    availableAt: task.availableAt,
    startedAt: task.startedAt ?? null,
    finishedAt: task.finishedAt ?? null,
    result: cloneJson(task.result),
    error: task.error ?? null,
  };
}

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const out: { [key: string]: JsonValue } = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = cloneJson(item);
  }
  return out;
}
