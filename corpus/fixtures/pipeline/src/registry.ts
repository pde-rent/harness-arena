import { alertHandler } from "./handlers/alert";
import { auditHandler } from "./handlers/audit";
import { fallbackHandler } from "./handlers/fallback";
import { metricHandler } from "./handlers/metric";
import { traceHandler } from "./handlers/trace";
import type { EventKind, Handler } from "./types";

export interface Registration {
  kind: EventKind;
  name: string;
  handler: Handler;
}

export class HandlerRegistry {
  private readonly entries = new Map<EventKind, Registration>();
  private fallback: Handler;

  constructor(fallback: Handler) {
    this.fallback = fallback;
  }

  register(kind: EventKind, name: string, handler: Handler): this {
    this.entries.set(kind, { kind, name, handler });
    return this;
  }

  unregister(kind: EventKind): boolean {
    return this.entries.delete(kind);
  }

  setFallback(handler: Handler): void {
    this.fallback = handler;
  }

  has(kind: EventKind): boolean {
    return this.entries.has(kind);
  }

  nameFor(kind: EventKind): string {
    return this.entries.get(kind)?.name ?? "fallback";
  }

  kinds(): EventKind[] {
    return Array.from(this.entries.keys()).sort();
  }

  resolveHandler(kind: EventKind): Handler {
    const entry = this.entries.get(kind);
    return entry ? entry.handler : this.fallback;
  }

  clone(): HandlerRegistry {
    const copy = new HandlerRegistry(this.fallback);
    for (const entry of this.entries.values()) {
      copy.register(entry.kind, entry.name, entry.handler);
    }
    return copy;
  }
}

export function createRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry(fallbackHandler);
  registry.register("audit", "audit", auditHandler);
  registry.register("metric", "metric", metricHandler);
  registry.register("alert", "alert", alertHandler);
  registry.register("trace", "trace", traceHandler);
  return registry;
}

export const defaultRegistry = createRegistry();

export function resolveHandler(
  kind: EventKind,
  registry: HandlerRegistry = defaultRegistry,
): Handler {
  return registry.resolveHandler(kind);
}
