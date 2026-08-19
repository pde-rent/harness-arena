import type { Task } from "./types";

export interface ReadyEntry {
  id: string;
  priority: number;
  seq: number;
}

export function toEntry(task: Task): ReadyEntry {
  return { id: task.id, priority: task.priority, seq: task.seq };
}

export function compareEntries(a: ReadyEntry, b: ReadyEntry): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.seq !== b.seq) return a.seq - b.seq;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function compareTasks(a: Task, b: Task): number {
  return compareEntries(toEntry(a), toEntry(b));
}

export function sortByPriority(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}

export class ReadyQueue {
  private readonly heap: ReadyEntry[] = [];
  private readonly members = new Set<string>();

  get size(): number {
    return this.heap.length;
  }

  has(id: string): boolean {
    return this.members.has(id);
  }

  push(entry: ReadyEntry): boolean {
    if (this.members.has(entry.id)) return false;
    this.members.add(entry.id);
    this.heap.push({ ...entry });
    this.siftUp(this.heap.length - 1);
    return true;
  }

  peek(): ReadyEntry | null {
    return this.heap.length > 0 ? { ...this.heap[0]! } : null;
  }

  pop(): ReadyEntry | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    this.members.delete(top.id);
    return top;
  }

  remove(id: string): boolean {
    if (!this.members.has(id)) return false;
    const at = this.heap.findIndex((entry) => entry.id === id);
    if (at < 0) {
      this.members.delete(id);
      return false;
    }
    const last = this.heap.pop()!;
    this.members.delete(id);
    if (at < this.heap.length) {
      this.heap[at] = last;
      this.siftDown(at);
      this.siftUp(at);
    }
    return true;
  }

  clear(): void {
    this.heap.length = 0;
    this.members.clear();
  }

  drain(): ReadyEntry[] {
    const out: ReadyEntry[] = [];
    for (;;) {
      const next = this.pop();
      if (next === null) break;
      out.push(next);
    }
    return out;
  }

  toSortedArray(): ReadyEntry[] {
    return [...this.heap].sort(compareEntries).map((entry) => ({ ...entry }));
  }

  private siftUp(start: number): void {
    let at = start;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (compareEntries(this.heap[at]!, this.heap[parent]!) >= 0) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  private siftDown(start: number): void {
    let at = start;
    const size = this.heap.length;
    for (;;) {
      const left = at * 2 + 1;
      const right = left + 1;
      let best = at;
      if (left < size && compareEntries(this.heap[left]!, this.heap[best]!) < 0) {
        best = left;
      }
      if (right < size && compareEntries(this.heap[right]!, this.heap[best]!) < 0) {
        best = right;
      }
      if (best === at) break;
      this.swap(at, best);
      at = best;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.heap[a]!;
    this.heap[a] = this.heap[b]!;
    this.heap[b] = tmp;
  }
}
