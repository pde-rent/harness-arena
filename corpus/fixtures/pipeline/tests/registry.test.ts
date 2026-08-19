import { describe, expect, test } from "bun:test";
import { FrozenClock, noopSleep } from "../src/clock";
import { CollectingLogger } from "../src/log";
import { MetricsSink } from "../src/metrics";
import { MemoryStore } from "../src/store";
import { HandlerRegistry, createRegistry, resolveHandler } from "../src/registry";
import { fallbackHandler } from "../src/handlers/fallback";
import { auditHandler } from "../src/handlers/audit";
import type { Event, HandlerContext } from "../src/types";

function context(): HandlerContext {
  return {
    logger: new CollectingLogger(),
    metrics: new MetricsSink(),
    clock: new FrozenClock(),
    sleep: noopSleep,
    store: new MemoryStore(),
  };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    kind: "audit",
    id: "EV-1",
    timestamp: 1_700_000_000,
    source: "svc.auth",
    body: { actor: "u1", action: "login" },
    ...overrides,
  };
}

describe("registry", () => {
  test("knows every registered kind", () => {
    const registry = createRegistry();
    expect(registry.kinds()).toEqual(["alert", "audit", "metric", "trace"]);
    expect(registry.has("unknown")).toBe(false);
  });

  test("falls back for unregistered kinds", () => {
    const registry = createRegistry();
    expect(registry.resolveHandler("unknown")).toBe(fallbackHandler);
    expect(registry.nameFor("unknown")).toBe("fallback");
    expect(registry.nameFor("audit")).toBe("audit");
  });

  test("resolves the audit handler through the module helper", () => {
    expect(resolveHandler("audit")).toBe(auditHandler);
  });

  test("unregistering routes the kind to the fallback", () => {
    const registry = createRegistry();
    expect(registry.unregister("alert")).toBe(true);
    expect(registry.resolveHandler("alert")).toBe(fallbackHandler);
  });

  test("clone is independent of its source", () => {
    const registry = createRegistry();
    const copy = registry.clone();
    copy.unregister("trace");
    expect(registry.has("trace")).toBe(true);
    expect(copy.has("trace")).toBe(false);
  });

  test("a custom fallback receives unrouted events", async () => {
    const registry = new HandlerRegistry(fallbackHandler);
    const ctx = context();
    const output = await registry.resolveHandler("metric")(
      event({ kind: "metric", id: "M-9" }),
      ctx,
    );
    expect(output.handler).toBe("fallback");
    expect(output.accepted).toBe(false);
    expect(ctx.store.keys("quarantine")).toEqual(["svc.auth:M-9"]);
  });
});
