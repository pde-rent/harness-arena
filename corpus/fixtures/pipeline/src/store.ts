import type { RecordStore } from "./types";

export class MemoryStore implements RecordStore {
  private readonly data = new Map<string, Map<string, Record<string, unknown>>>();

  put(namespace: string, key: string, value: Record<string, unknown>): void {
    let bucket = this.data.get(namespace);
    if (!bucket) {
      bucket = new Map();
      this.data.set(namespace, bucket);
    }
    bucket.set(key, value);
  }

  get(namespace: string, key: string): Record<string, unknown> | undefined {
    return this.data.get(namespace)?.get(key);
  }

  keys(namespace: string): string[] {
    const bucket = this.data.get(namespace);
    return bucket ? Array.from(bucket.keys()).sort() : [];
  }

  namespaces(): string[] {
    return Array.from(this.data.keys()).sort();
  }

  size(): number {
    let total = 0;
    for (const bucket of this.data.values()) {
      total += bucket.size;
    }
    return total;
  }

  clear(): void {
    this.data.clear();
  }
}

export function createStore(): MemoryStore {
  return new MemoryStore();
}
