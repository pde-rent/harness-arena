import type { DependencyGraph } from "./graph";
import { toEntry, type ReadyQueue } from "./priority";
import type { TaskStore } from "./store";
import type { Task } from "./types";
import { isTerminal } from "./types";

export interface Classification {
  ready: Task[];
  waiting: Task[];
  blocked: Task[];
  doomed: Task[];
}

export function classifyPending(
  store: TaskStore,
  graph: DependencyGraph,
  now: number,
): Classification {
  const result: Classification = { ready: [], waiting: [], blocked: [], doomed: [] };
  for (const task of store.byState("pending")) {
    const deps = dependenciesOf(task, graph);
    let satisfied = true;
    let doomed = false;
    for (const dep of deps) {
      const upstream = store.get(dep);
      if (upstream === undefined || upstream.state !== "done") {
        satisfied = false;
      }
      if (upstream !== undefined && upstream.state !== "done" && isTerminal(upstream.state)) {
        doomed = true;
      }
    }
    if (doomed) {
      result.doomed.push(task);
    } else if (!satisfied) {
      result.blocked.push(task);
    } else if (task.availableAt > now) {
      result.waiting.push(task);
    } else {
      result.ready.push(task);
    }
  }
  return result;
}

export function promoteReady(
  store: TaskStore,
  graph: DependencyGraph,
  queue: ReadyQueue,
  now: number,
): string[] {
  const promoted: string[] = [];
  for (const task of classifyPending(store, graph, now).ready) {
    const next = store.update(task.id, { state: "ready" });
    if (queue.push(toEntry(next))) {
      promoted.push(next.id);
    }
  }
  return promoted;
}

export function cascadeFailure(
  store: TaskStore,
  graph: DependencyGraph,
  rootId: string,
  queue: ReadyQueue,
  now: number,
): string[] {
  const affected: string[] = [];
  for (const id of graph.dependentsOf(rootId)) {
    const task = store.get(id);
    if (task === undefined || isTerminal(task.state)) continue;
    queue.remove(id);
    store.update(id, {
      state: "failed",
      error: `dependency failed: ${rootId}`,
      finishedAt: now,
    });
    affected.push(id);
  }
  return affected;
}

export function nextDeadline(
  store: TaskStore,
  graph: DependencyGraph,
  now: number,
): number | null {
  const waiting = classifyPending(store, graph, now).waiting;
  if (waiting.length === 0) return null;
  return waiting.reduce(
    (min, task) => Math.min(min, task.availableAt),
    Number.POSITIVE_INFINITY,
  );
}

function dependenciesOf(task: Task, graph: DependencyGraph): string[] {
  const merged = new Set<string>(task.deps);
  for (const dep of graph.dependenciesOf(task.id)) merged.add(dep);
  return [...merged];
}
