import { describe, expect, test } from "bun:test";
import { MetricsSink } from "../src/metrics";
import {
  CORE_VALIDATORS,
  errorsOf,
  hasBlockingIssue,
  runValidators,
  summarizeIssues,
  warningsOf,
} from "../src/validate";
import { hasValidIdShape, normalizeSource, validateIdentity } from "../src/validate/identity";
import {
  MAX_BODY_KEYS,
  MAX_STRING_LENGTH,
  MIN_TIMESTAMP,
  countBodyKeys,
  longestStringLength,
  validateLimits,
} from "../src/validate/limits";
import { requiredFieldsFor, validateSchema } from "../src/validate/schema";
import type { Event, ValidationIssue } from "../src/types";

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

function bodyWith(count: number): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (let i = 0; i < count; i += 1) body[`k${i}`] = i;
  return body;
}

function shape(issues: ValidationIssue[]): string[] {
  return issues.map((i) => `${i.severity}|${i.code}|${i.field}|${i.message}`);
}

describe("schema validator (hidden)", () => {
  test("required field tables are unchanged", () => {
    expect(requiredFieldsFor("audit")).toEqual(["actor", "action"]);
    expect(requiredFieldsFor("metric")).toEqual(["name", "value"]);
    expect(requiredFieldsFor("alert")).toEqual(["severity", "summary"]);
    expect(requiredFieldsFor("trace")).toEqual(["traceId", "spanId"]);
    expect(requiredFieldsFor("unknown")).toEqual([]);
    const copy = requiredFieldsFor("audit");
    copy.push("mutated");
    expect(requiredFieldsFor("audit")).toEqual(["actor", "action"]);
  });

  test("valid events of every kind are clean", () => {
    expect(validateSchema(event())).toEqual([]);
    expect(
      validateSchema(event({ kind: "metric", body: { name: "cpu", value: 1 } })),
    ).toEqual([]);
    expect(
      validateSchema(event({ kind: "alert", body: { severity: "high", summary: "s" } })),
    ).toEqual([]);
    expect(
      validateSchema(event({ kind: "trace", body: { traceId: "t", spanId: "s" } })),
    ).toEqual([]);
  });

  test("missing fields are reported once each, in declaration order", () => {
    expect(shape(validateSchema(event({ body: {} })))).toEqual([
      'error|schema.missing_field|actor|required field "actor" is absent',
      'error|schema.missing_field|action|required field "action" is absent',
    ]);
  });

  test("an explicit undefined counts as missing", () => {
    expect(shape(validateSchema(event({ body: { actor: undefined, action: "login" } })))).toEqual([
      'error|schema.missing_field|actor|required field "actor" is absent',
    ]);
  });

  test("falsy present values are not missing", () => {
    expect(validateSchema(event({ body: { actor: "", action: 0 } }))).toEqual([]);
  });

  test("numeric fields are type checked only when present", () => {
    expect(shape(validateSchema(event({ kind: "metric", body: { name: "cpu", value: "high" } })))).toEqual([
      'error|schema.bad_type|value|field "value" must be a number',
    ]);
    expect(shape(validateSchema(event({ kind: "metric", body: { name: "cpu" } })))).toEqual([
      'error|schema.missing_field|value|required field "value" is absent',
    ]);
    expect(
      validateSchema(event({ kind: "trace", body: { traceId: "t", spanId: "s", durationMs: 5 } })),
    ).toEqual([]);
    expect(
      shape(validateSchema(event({ kind: "trace", body: { traceId: "t", spanId: "s", durationMs: "5" } }))),
    ).toEqual(['error|schema.bad_type|durationMs|field "durationMs" must be a number']);
  });

  test("unknown kinds warn, and only warn", () => {
    expect(shape(validateSchema(event({ kind: "unknown", body: {} })))).toEqual([
      "warning|schema.unknown_kind|kind|event kind is not recognised",
    ]);
  });

  test("missing fields and bad types accumulate together", () => {
    expect(shape(validateSchema(event({ kind: "metric", body: { value: true } })))).toEqual([
      'error|schema.missing_field|name|required field "name" is absent',
      'error|schema.bad_type|value|field "value" must be a number',
    ]);
  });
});

describe("limits validator (hidden)", () => {
  test("helpers keep measuring the same things", () => {
    expect(countBodyKeys(event({ body: {} }))).toBe(0);
    expect(countBodyKeys(event({ body: bodyWith(7) }))).toBe(7);
    expect(longestStringLength(event({ body: { a: "xxx", b: 12345, c: "xxxxx" } }))).toBe(5);
    expect(longestStringLength(event({ body: { a: 1 } }))).toBe(0);
  });

  test("boundaries are inclusive on the passing side", () => {
    expect(validateLimits(event({ body: bodyWith(MAX_BODY_KEYS) }))).toEqual([]);
    expect(shape(validateLimits(event({ body: bodyWith(MAX_BODY_KEYS + 1) })))).toEqual([
      "error|limits.too_many_keys|body|body has 33 keys, limit is 32",
    ]);
    expect(validateLimits(event({ body: { a: "x".repeat(MAX_STRING_LENGTH) } }))).toEqual([]);
    expect(shape(validateLimits(event({ body: { a: "x".repeat(MAX_STRING_LENGTH + 1) } })))).toEqual([
      "warning|limits.string_too_long|body|body contains a string of 513 characters",
    ]);
    expect(validateLimits(event({ timestamp: MIN_TIMESTAMP }))).toEqual([]);
    expect(shape(validateLimits(event({ timestamp: MIN_TIMESTAMP - 1 })))).toEqual([
      "error|limits.timestamp_too_old|timestamp|timestamp 999999999 predates the accepted window",
    ]);
  });

  test("all three limit issues can fire at once, in a fixed order", () => {
    const body = bodyWith(MAX_BODY_KEYS + 1);
    body.big = "y".repeat(MAX_STRING_LENGTH + 2);
    expect(shape(validateLimits(event({ body, timestamp: 5 })))).toEqual([
      "error|limits.too_many_keys|body|body has 34 keys, limit is 32",
      "warning|limits.string_too_long|body|body contains a string of 514 characters",
      "error|limits.timestamp_too_old|timestamp|timestamp 5 predates the accepted window",
    ]);
  });
});

describe("identity validator (hidden)", () => {
  test("id shape rules are unchanged", () => {
    expect(hasValidIdShape("ab")).toBe(true);
    expect(hasValidIdShape("a")).toBe(false);
    expect(hasValidIdShape("a".repeat(64))).toBe(true);
    expect(hasValidIdShape("a".repeat(65))).toBe(false);
    expect(hasValidIdShape("a_b.c:d-e")).toBe(true);
    expect(hasValidIdShape("bad id")).toBe(false);
    expect(hasValidIdShape("bad!")).toBe(false);
  });

  test("source normalization is unchanged", () => {
    expect(normalizeSource("  SVC.Auth ")).toBe("svc.auth");
    expect(normalizeSource("\t\n")).toBe("");
  });

  test("a well formed identity is clean", () => {
    expect(validateIdentity(event())).toEqual([]);
    expect(validateIdentity(event({ id: "a".repeat(64), source: " SVC.Auth " }))).toEqual([]);
  });

  test("bad ids report the raw id in the message", () => {
    expect(shape(validateIdentity(event({ id: "bad id!" })))).toEqual([
      'error|identity.bad_id|id|id "bad id!" is not a valid identifier',
    ]);
  });

  test("empty and flat sources differ in code and severity", () => {
    expect(shape(validateIdentity(event({ source: "   " })))).toEqual([
      "error|identity.missing_source|source|source is empty",
    ]);
    expect(shape(validateIdentity(event({ source: " AUTH " })))).toEqual([
      'warning|identity.flat_source|source|source "auth" is not namespaced',
    ]);
  });

  test("id and source issues accumulate, id first", () => {
    expect(shape(validateIdentity(event({ id: "!", source: "auth" })))).toEqual([
      'error|identity.bad_id|id|id "!" is not a valid identifier',
      'warning|identity.flat_source|source|source "auth" is not namespaced',
    ]);
  });
});

describe("runValidators (hidden)", () => {
  test("a clean event produces nothing and still counts a run", () => {
    const metrics = new MetricsSink();
    expect(runValidators(event(), { metrics })).toEqual([]);
    expect(summarizeIssues([])).toBe("clean");
    expect(metrics.snapshot()).toEqual({ "validate.runs": 1 });
  });

  test("issues are aggregated in validator order: schema, limits, identity", () => {
    const bad = event({
      kind: "unknown",
      id: "!",
      timestamp: 5,
      source: "auth",
      body: {},
    });
    expect(shape(runValidators(bad))).toEqual([
      "warning|schema.unknown_kind|kind|event kind is not recognised",
      "error|limits.timestamp_too_old|timestamp|timestamp 5 predates the accepted window",
      'error|identity.bad_id|id|id "!" is not a valid identifier',
      'warning|identity.flat_source|source|source "auth" is not namespaced',
    ]);
  });

  test("per validator counters carry the number of issues produced", () => {
    const metrics = new MetricsSink();
    const bad = event({ kind: "unknown", id: "!", timestamp: 5, source: "auth", body: {} });
    runValidators(bad, { metrics });
    expect(metrics.snapshot()).toEqual({
      "validate.schema.issues": 1,
      "validate.limits.issues": 1,
      "validate.identity.issues": 2,
      "validate.runs": 1,
    });
  });

  test("validators that produce nothing emit no counter", () => {
    const metrics = new MetricsSink();
    runValidators(event({ source: "auth" }), { metrics });
    expect(metrics.snapshot()).toEqual({
      "validate.identity.issues": 1,
      "validate.runs": 1,
    });
  });

  test("counters accumulate across runs", () => {
    const metrics = new MetricsSink();
    runValidators(event({ id: "!" }), { metrics });
    runValidators(event({ id: "!" }), { metrics });
    expect(metrics.read("validate.runs")).toBe(2);
    expect(metrics.read("validate.identity.issues")).toBe(2);
  });

  test("a custom validator set replaces the core set entirely", () => {
    const metrics = new MetricsSink();
    const issues = runValidators(event({ id: "!", timestamp: 5 }), {
      metrics,
      validators: [CORE_VALIDATORS[0]!],
    });
    expect(issues).toEqual([]);
    expect(metrics.snapshot()).toEqual({ "validate.runs": 1 });
  });

  test("severity partitioning and summary are unchanged", () => {
    const issues = runValidators(
      event({ kind: "unknown", id: "!", timestamp: 5, source: "auth", body: {} }),
    );
    expect(hasBlockingIssue(issues)).toBe(true);
    expect(errorsOf(issues).map((i) => i.code)).toEqual([
      "limits.timestamp_too_old",
      "identity.bad_id",
    ]);
    expect(warningsOf(issues).map((i) => i.code)).toEqual([
      "schema.unknown_kind",
      "identity.flat_source",
    ]);
    expect(summarizeIssues(issues)).toBe(
      "error:identity.bad_id,error:limits.timestamp_too_old,warning:identity.flat_source,warning:schema.unknown_kind",
    );
    expect(hasBlockingIssue(warningsOf(issues))).toBe(false);
  });
});
