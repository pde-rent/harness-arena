import { describe, expect, test } from "bun:test";
import { MetricsSink } from "../src/metrics";
import {
  errorsOf,
  hasBlockingIssue,
  runValidators,
  summarizeIssues,
  warningsOf,
} from "../src/validate";
import { validateIdentity } from "../src/validate/identity";
import { MAX_BODY_KEYS, validateLimits } from "../src/validate/limits";
import { validateSchema } from "../src/validate/schema";
import type { Event } from "../src/types";

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

describe("schema validator", () => {
  test("accepts a complete audit event", () => {
    expect(validateSchema(event())).toEqual([]);
  });

  test("flags missing required fields", () => {
    const issues = validateSchema(event({ body: { actor: "u1" } }));
    expect(issues.map((issue) => issue.field)).toEqual(["action"]);
    expect(issues[0]?.code).toBe("schema.missing_field");
  });

  test("flags a non numeric metric value", () => {
    const issues = validateSchema(
      event({ kind: "metric", body: { name: "cpu", value: "high" } }),
    );
    expect(issues[0]?.code).toBe("schema.bad_type");
  });

  test("warns on unknown kinds", () => {
    const issues = validateSchema(event({ kind: "unknown", body: {} }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
  });
});

describe("limits validator", () => {
  test("passes a small body", () => {
    expect(validateLimits(event())).toEqual([]);
  });

  test("rejects oversized bodies", () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_BODY_KEYS; i += 1) body[`k${i}`] = i;
    const issues = validateLimits(event({ body }));
    expect(issues[0]?.code).toBe("limits.too_many_keys");
  });

  test("rejects ancient timestamps", () => {
    const issues = validateLimits(event({ timestamp: 5 }));
    expect(issues.map((issue) => issue.code)).toContain("limits.timestamp_too_old");
  });

  test("warns on long strings", () => {
    const issues = validateLimits(event({ body: { actor: "x".repeat(600) } }));
    expect(issues[0]?.severity).toBe("warning");
  });
});

describe("identity validator", () => {
  test("rejects malformed ids", () => {
    expect(validateIdentity(event({ id: "a" }))[0]?.code).toBe("identity.bad_id");
    expect(validateIdentity(event({ id: "bad id!" }))[0]?.code).toBe(
      "identity.bad_id",
    );
  });

  test("rejects empty sources", () => {
    const issues = validateIdentity(event({ source: "  " }));
    expect(issues[0]?.code).toBe("identity.missing_source");
  });

  test("warns on flat sources", () => {
    const issues = validateIdentity(event({ source: "auth" }));
    expect(issues[0]?.code).toBe("identity.flat_source");
    expect(issues[0]?.severity).toBe("warning");
  });
});

describe("runValidators", () => {
  test("aggregates every validator and reports metrics", () => {
    const metrics = new MetricsSink();
    const issues = runValidators(event({ id: "!", timestamp: 1 }), { metrics });
    expect(hasBlockingIssue(issues)).toBe(true);
    expect(errorsOf(issues).length).toBeGreaterThanOrEqual(2);
    expect(warningsOf(issues)).toEqual([]);
    expect(metrics.read("validate.runs")).toBe(1);
    expect(metrics.read("validate.identity.issues")).toBe(1);
  });

  test("summarizes a clean event", () => {
    const issues = runValidators(event());
    expect(issues).toEqual([]);
    expect(summarizeIssues(issues)).toBe("clean");
  });

  test("honours a custom validator set", () => {
    const issues = runValidators(event({ id: "!" }), {
      validators: [{ name: "schema", run: validateSchema }],
    });
    expect(issues).toEqual([]);
  });
});
