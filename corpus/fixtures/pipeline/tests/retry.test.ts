import { describe, expect, test } from "bun:test";
import { SeededRng, createSleepRecorder } from "../src/clock";
import { MetricsSink } from "../src/metrics";
import {
  AGGRESSIVE_RETRY_POLICY,
  DEFAULT_RETRY_POLICY,
  RetryExhaustedError,
  applyJitter,
  backoffSchedule,
  computeBackoffMs,
  withRetry,
} from "../src/retry";

describe("computeBackoffMs", () => {
  test("grows geometrically from the base delay", () => {
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 1)).toBe(50);
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 2)).toBe(150);
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 3)).toBe(450);
  });

  test("clamps at maxDelayMs", () => {
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 4)).toBe(1000);
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 40)).toBe(1000);
  });

  test("returns zero for non positive attempts", () => {
    expect(computeBackoffMs(DEFAULT_RETRY_POLICY, 0)).toBe(0);
  });

  test("produces one delay fewer than the attempt budget", () => {
    expect(backoffSchedule(DEFAULT_RETRY_POLICY)).toEqual([50, 150, 450, 1000]);
    expect(backoffSchedule(AGGRESSIVE_RETRY_POLICY)).toHaveLength(7);
  });

  test("jitter is inert at ratio zero and deterministic otherwise", () => {
    const rng = new SeededRng(7);
    expect(applyJitter(DEFAULT_RETRY_POLICY, 100, rng)).toBe(100);
    const jittered = applyJitter(
      { ...DEFAULT_RETRY_POLICY, jitterRatio: 0.5 },
      100,
      new SeededRng(7),
    );
    expect(jittered).toBe(
      applyJitter({ ...DEFAULT_RETRY_POLICY, jitterRatio: 0.5 }, 100, new SeededRng(7)),
    );
    expect(jittered).toBeGreaterThanOrEqual(75);
    expect(jittered).toBeLessThanOrEqual(125);
  });
});

describe("withRetry", () => {
  test("returns the first successful value", async () => {
    const metrics = new MetricsSink();
    const value = await withRetry(() => "ok", DEFAULT_RETRY_POLICY, {
      label: "unit",
      metrics,
    });
    expect(value).toBe("ok");
    expect(metrics.read("unit.attempt")).toBe(1);
    expect(metrics.read("unit.failure")).toBe(0);
  });

  test("retries until success and sleeps with backoff", async () => {
    const recorder = createSleepRecorder();
    let calls = 0;
    const value = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) throw new Error("flaky");
        return calls;
      },
      DEFAULT_RETRY_POLICY,
      { label: "unit", sleep: recorder.sleep },
    );
    expect(value).toBe(3);
    expect(recorder.waits).toEqual([50, 150]);
  });

  test("throws RetryExhaustedError after the attempt budget", async () => {
    const metrics = new MetricsSink();
    const recorder = createSleepRecorder();
    let calls = 0;
    const promise = withRetry(
      () => {
        calls += 1;
        throw new Error("always");
      },
      { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 },
      { label: "unit", sleep: recorder.sleep, metrics },
    );
    await expect(promise).rejects.toThrow(RetryExhaustedError);
    expect(calls).toBe(3);
    expect(recorder.waits).toEqual([50, 150]);
    expect(metrics.read("unit.exhausted")).toBe(1);
    expect(metrics.read("unit.failure")).toBe(3);
  });

  test("stops early when shouldRetry declines", async () => {
    let calls = 0;
    const promise = withRetry(
      () => {
        calls += 1;
        throw new Error("fatal");
      },
      DEFAULT_RETRY_POLICY,
      { label: "unit", shouldRetry: () => false },
    );
    await expect(promise).rejects.toThrow(/failed after/);
    expect(calls).toBe(1);
  });

  test("passes the attempt number to the callback", async () => {
    const seen: number[] = [];
    await withRetry(
      (attempt) => {
        seen.push(attempt);
        if (attempt < 2) throw new Error("retry");
        return attempt;
      },
      DEFAULT_RETRY_POLICY,
      {},
    );
    expect(seen).toEqual([1, 2]);
  });
});
