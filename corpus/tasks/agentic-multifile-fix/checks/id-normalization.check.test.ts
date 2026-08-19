import { describe, expect, test } from "bun:test";
import { SteppingClock, createSleepRecorder } from "../src/clock";
import { CollectingLogger } from "../src/log";
import { MetricsSink } from "../src/metrics";
import { MemoryStore } from "../src/store";
import { parseEvent } from "../src/parse";
import { transformEvent } from "../src/transform";
import { runValidators } from "../src/validate";
import { runPipeline, runPipelineBatch, type PipelineDeps } from "../src/pipeline";
import type { Event } from "../src/types";

const BODY = '{"actor":"u1","action":"login"}';
const TS = 1700000001;

function raw(id: string, source = "svc.auth", ts: number = TS, body = BODY): string {
  return `audit|${id}|${ts}|${source}\n${body}`;
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    kind: "audit",
    id: "EV-1",
    timestamp: TS,
    source: "svc.auth",
    body: { actor: "u1", action: "login" },
    ...overrides,
  };
}

function deps(): PipelineDeps & {
  store: MemoryStore;
  metrics: MetricsSink;
  logger: CollectingLogger;
} {
  return {
    logger: new CollectingLogger(),
    metrics: new MetricsSink(),
    clock: new SteppingClock({ start: 1_700_000_000_000, step: 1 }),
    sleep: createSleepRecorder().sleep,
    store: new MemoryStore(),
  };
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe("parseEvent normalises the id it derives", () => {
  test("upper-cases a lower case id", () => {
    expect(parseEvent(raw("ev-9")).id).toBe("EV-9");
  });

  test("upper-cases a mixed case id", () => {
    expect(parseEvent(raw("Ev-9")).id).toBe("EV-9");
  });

  test("trims and upper-cases a padded id", () => {
    expect(parseEvent(raw("  ev-9\t")).id).toBe("EV-9");
  });

  test("leaves an already canonical id alone", () => {
    expect(parseEvent(raw("EV-9")).id).toBe("EV-9");
    expect(parseEvent(raw("EV-9")).kind).toBe("audit");
    expect(parseEvent(raw("EV-9")).source).toBe("svc.auth");
  });
});

describe("validation normalises the id it checks and reports", () => {
  test("a padded id is not a malformed identifier", () => {
    expect(codes(runValidators(event({ id: "  ev-9  " })))).not.toContain(
      "identity.bad_id",
    );
    expect(runValidators(event({ id: "  ev-9  " }))).toEqual([]);
  });

  test("a tab padded id is not a malformed identifier", () => {
    expect(runValidators(event({ id: "\tEV-9\t" }))).toEqual([]);
  });

  test("a genuinely malformed id is still rejected, quoted in normalised form", () => {
    const issues = runValidators(event({ id: "  b@d id  " }));
    const bad = issues.find((issue) => issue.code === "identity.bad_id");
    expect(bad).toBeDefined();
    expect(bad?.severity).toBe("error");
    expect(bad?.message).toContain('"B@D ID"');
  });

  test("an id that is too short is still rejected", () => {
    expect(codes(runValidators(event({ id: " a " })))).toContain("identity.bad_id");
  });
});

describe("transform normalises the id it hands on", () => {
  test("trims and upper-cases", () => {
    expect(transformEvent(event({ id: "  ev-9  " })).id).toBe("EV-9");
    expect(transformEvent(event({ id: "ev-9" })).id).toBe("EV-9");
    expect(transformEvent(event({ id: "EV-9" })).id).toBe("EV-9");
  });

  test("does not disturb the rest of the event", () => {
    const out = transformEvent(event({ id: " ev-9 ", source: "  SVC.Auth " }));
    expect(out.source).toBe("svc.auth");
    expect(out.kind).toBe("audit");
    expect(out.body.actor).toBe("u1");
  });
});

describe("the pipeline reports and stores one spelling", () => {
  test("an accepted event is stored under the normalised id", async () => {
    const d = deps();
    const result = await runPipeline(raw("  ev-9 "), d);
    expect(result.ok).toBe(true);
    expect(result.id).toBe("EV-9");
    expect(d.store.keys("audit")).toEqual(["EV-9"]);
    expect(d.store.get("audit", "EV-9")?.actor).toBe("u1");
    expect(d.store.keys("audit.journal")).toEqual(["EV-9:write"]);
  });

  test("a rejected event reports the normalised id", async () => {
    const d = deps();
    const result = await runPipeline(raw(" ev-9 ", ""), d);
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("validate");
    expect(result.id).toBe("EV-9");
    expect(codes(result.issues)).toContain("identity.missing_source");
  });

  test("an unroutable event is quarantined under the normalised id", async () => {
    const d = deps();
    const result = await runPipeline(
      `weird| x-7 |${TS}|svc.lab\n{"foo":1}`,
      d,
    );
    expect(result.id).toBe("X-7");
    expect(d.store.keys("quarantine")).toEqual(["svc.lab:X-7"]);
  });

  test("spellings of one id collapse to a single record", async () => {
    const d = deps();
    const results = await runPipelineBatch(
      [raw("EV-9"), raw("  ev-9 ", "svc.auth", TS + 1), raw("Ev-9", "svc.auth", TS + 2)],
      d,
    );
    expect(results.map((r) => r.id)).toEqual(["EV-9", "EV-9", "EV-9"]);
    expect(results.map((r) => r.output?.detail.stage)).toEqual([
      "write",
      "amend",
      "amend",
    ]);
    expect(d.store.keys("audit")).toEqual(["EV-9"]);
    expect(d.store.keys("audit.journal")).toEqual(["EV-9:amend", "EV-9:write"]);
  });
});

describe("every id-derivation site obeys the same rule", () => {
  test("parse, validate, transform and the pipeline agree on one spelling", async () => {
    const awkward = "  eV-42\t";
    const canonical = "EV-42";

    // derived by the parser
    const parsed = parseEvent(raw(awkward));
    expect(parsed.id).toBe(canonical);

    // validated on an object handed in directly, still padded
    expect(runValidators(event({ id: awkward }))).toEqual([]);
    const badly = runValidators(event({ id: "  ev-42!  " }));
    expect(badly.find((i) => i.code === "identity.bad_id")?.message).toContain(
      '"EV-42!"',
    );

    // transformed from an object handed in directly
    expect(transformEvent(event({ id: awkward })).id).toBe(canonical);

    // and end to end, including what it is stored under
    const d = deps();
    const result = await runPipeline(raw(awkward), d);
    expect(result.ok).toBe(true);
    expect(result.id).toBe(canonical);
    expect(d.store.keys("audit")).toEqual([canonical]);
    expect(d.store.keys("audit.journal")).toEqual([`${canonical}:write`]);
  });
});
