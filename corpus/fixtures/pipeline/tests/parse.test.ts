import { describe, expect, test } from "bun:test";
import { formatEvent, parseEvent, tryParseEvent } from "../src/parse";
import { splitHeaderFields, splitHeaderLine } from "../src/parse";
import { PipelineError } from "../src/types";

const AUDIT_RAW = 'audit|EV-1|1700000001|svc.auth\n{"actor":"u1","action":"login"}';

describe("parseEvent", () => {
  test("parses a well formed payload", () => {
    const event = parseEvent(AUDIT_RAW);
    expect(event.kind).toBe("audit");
    expect(event.id).toBe("EV-1");
    expect(event.timestamp).toBe(1700000001);
    expect(event.source).toBe("svc.auth");
    expect(event.body).toEqual({ actor: "u1", action: "login" });
    expect(event.headerFieldCount).toBe(4);
    expect(event.bodyBytes).toBeGreaterThan(0);
  });

  test("tolerates a missing body", () => {
    const event = parseEvent("metric|M-1|1700000002|svc.stats\n");
    expect(event.body).toEqual({});
    expect(event.bodyBytes).toBe(0);
  });

  test("maps unrecognised kinds to unknown", () => {
    const event = parseEvent("weird|W-1|1700000003|svc.x\n{}");
    expect(event.kind).toBe("unknown");
  });

  test("trims header whitespace", () => {
    const event = parseEvent("  alert | A-1 | 1700000004 | svc.ops \n{}");
    expect(event.kind).toBe("alert");
    expect(event.id).toBe("A-1");
    expect(event.source).toBe("svc.ops");
  });

  test("rejects a short header", () => {
    expect(() => parseEvent("audit|EV-1\n{}")).toThrow(PipelineError);
  });

  test("rejects a non numeric timestamp", () => {
    expect(() => parseEvent("audit|EV-1|nope|svc.auth\n{}")).toThrow(
      /not numeric/,
    );
  });

  test("rejects a non object body", () => {
    expect(() => parseEvent("audit|EV-1|1|svc.auth\n[1,2]")).toThrow(
      /JSON object/,
    );
    expect(() => parseEvent("audit|EV-1|1|svc.auth\n{oops")).toThrow(
      /valid JSON/,
    );
  });

  test("rejects an empty payload", () => {
    expect(() => parseEvent("   ")).toThrow(/empty payload/);
  });

  test("tryParseEvent swallows failures", () => {
    expect(tryParseEvent("garbage")).toBeUndefined();
    expect(tryParseEvent(AUDIT_RAW)?.id).toBe("EV-1");
  });

  test("round trips through formatEvent", () => {
    const event = parseEvent(AUDIT_RAW);
    const again = parseEvent(formatEvent(event));
    expect(again.body).toEqual(event.body);
    expect(again.id).toBe(event.id);
  });
});

describe("header helpers", () => {
  test("splits header from body", () => {
    const { header, body } = splitHeaderLine("a|b\nrest\nmore");
    expect(header).toBe("a|b");
    expect(body).toBe("rest\nmore");
  });

  test("splits fields and trims each", () => {
    expect(splitHeaderFields(" a | b |c ")).toEqual(["a", "b", "c"]);
  });
});
