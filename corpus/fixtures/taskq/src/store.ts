import type { StateCounts, Task, TaskState } from "./types";

export class DuplicateTaskError extends Error {
  constructor(id: string) {
    super(`task already exists: ${id}`);
    this.name = "DuplicateTaskError";
  }
}

export class UnknownTaskError extends Error {
  constructor(id: string) {
    super(`unknown task: ${id}`);
    this.name = "UnknownTaskError";
  }
}

const EMPTY_COUNTS: StateCounts = {
  pending: 0,
  ready: 0,
  running: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
};

export class TaskStore {
  private readonly tasks = new Map<string, Task>();
  private insertions = 0;

  get size(): number {
    return this.tasks.size;
  }

  nextSeq(): number {
    return this.insertions;
  }

  add(task: Task): Task {
    if (this.tasks.has(task.id)) {
      throw new DuplicateTaskError(task.id);
    }
    const stored = Object.freeze({ ...task, deps: Object.freeze([...task.deps]) as string[] });
    this.tasks.set(task.id, stored);
    this.insertions = Math.max(this.insertions, task.seq + 1);
    return stored;
  }

  has(id: string): boolean {
    return this.tasks.has(id);
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  require(id: string): Task {
    const task = this.tasks.get(id);
    if (task === undefined) throw new UnknownTaskError(id);
    return task;
  }

  update(id: string, patch: Partial<Omit<Task, "id" | "seq">>): Task {
    const current = this.require(id);
    const next = Object.freeze({
      ...current,
      ...patch,
      id: current.id,
      seq: current.seq,
      deps: Object.freeze([...(patch.deps ?? current.deps)]) as string[],
    });
    this.tasks.set(id, next);
    return next;
  }

  all(): Task[] {
    return [...this.tasks.values()].sort((a, b) => a.seq - b.seq);
  }

  ids(): string[] {
    return this.all().map((task) => task.id);
  }

  byState(state: TaskState): Task[] {
    return this.all().filter((task) => task.state === state);
  }

  counts(): StateCounts {
    const counts: StateCounts = { ...EMPTY_COUNTS };
    for (const task of this.tasks.values()) {
      counts[task.state] += 1;
    }
    return counts;
  }

  clear(): void {
    this.tasks.clear();
    this.insertions = 0;
  }

  bulkLoad(tasks: Task[]): void {
    this.clear();
    for (const task of [...tasks].sort((a, b) => a.seq - b.seq)) {
      this.add(task);
    }
  }
}
