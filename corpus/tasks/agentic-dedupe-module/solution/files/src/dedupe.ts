/**
 * A bounded, insertion-ordered window of recently seen event ids.
 * Self-contained: no imports, no timers, no randomness.
 */
export class DuplicateWindow {
  readonly capacity: number;
  private readonly bound: number;
  private readonly seen = new Set<string>();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.bound =
      Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 0;
  }

  get size(): number {
    return this.seen.size;
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }

  record(id: string): boolean {
    if (this.bound <= 0) return false;
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    while (this.seen.size > this.bound) {
      const oldest = this.seen.values().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
    return false;
  }

  clear(): void {
    this.seen.clear();
  }
}
