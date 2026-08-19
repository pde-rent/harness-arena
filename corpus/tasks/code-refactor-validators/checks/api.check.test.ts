import { describe, expect, test } from "bun:test";
import * as validate from "../src/validate";

// The runtime export surface of src/validate/index.ts, exactly as the
// pristine repository defines it. Refactoring must not add, drop or rename
// anything here, nor change what kind of value each name holds.
const EXPECTED: Record<string, string> = {
  CORE_VALIDATORS: "object",
  errorsOf: "function",
  hasBlockingIssue: "function",
  runValidators: "function",
  summarizeIssues: "function",
  validateIdentity: "function",
  validateLimits: "function",
  validateSchema: "function",
  warningsOf: "function",
};

describe("public API of src/validate", () => {
  test("exports exactly the expected names", () => {
    const actual = Object.keys(validate as Record<string, unknown>).sort();
    expect(actual).toEqual(Object.keys(EXPECTED).sort());
  });

  test("each export still has the same type", () => {
    const mod = validate as unknown as Record<string, unknown>;
    for (const [name, kind] of Object.entries(EXPECTED)) {
      expect(`${name}:${typeof mod[name]}`).toBe(`${name}:${kind}`);
    }
  });

  test("CORE_VALIDATORS is unchanged in shape and order", () => {
    expect(validate.CORE_VALIDATORS.map((v) => v.name)).toEqual([
      "schema",
      "limits",
      "identity",
    ]);
    for (const v of validate.CORE_VALIDATORS) {
      expect(typeof v.run).toBe("function");
    }
  });

  test("the per-module entry points are still importable", async () => {
    const schema = await import("../src/validate/schema");
    const limits = await import("../src/validate/limits");
    const identity = await import("../src/validate/identity");
    expect(typeof schema.validateSchema).toBe("function");
    expect(typeof schema.requiredFieldsFor).toBe("function");
    expect(typeof limits.validateLimits).toBe("function");
    expect(limits.MAX_BODY_KEYS).toBe(32);
    expect(limits.MAX_STRING_LENGTH).toBe(512);
    expect(limits.MIN_TIMESTAMP).toBe(1_000_000_000);
    expect(typeof identity.validateIdentity).toBe("function");
    expect(typeof identity.normalizeSource).toBe("function");
    expect(identity.ID_MIN_LENGTH).toBe(2);
    expect(identity.ID_MAX_LENGTH).toBe(64);
  });
});
