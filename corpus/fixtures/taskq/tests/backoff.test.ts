import { describe, expect, test } from "bun:test";
import {
  attemptsRemaining,
  backoffDelay,
  backoffSeries,
  nextAvailableAt,
  shouldRetry,
} from "../src/backoff";
import { Lcg } from "../src/rng";
import { DEFAULT_BACKOFF, type BackoffOptions, type Task } from "../src/types";

const opts: BackoffOptions = {
  baseDelayMs: 100,
  factor: 2,
  maxDelayMs: 1000,
  jitter: false,
};

function task(attempts: number, maxAttempts: number): Task {
  return {
    id: "t",
    seq: 0,
    priority: 0,
    deps: [],
    handler: null,
    payload: null,
    state: "failed",
    attempts,
    maxAttempts,
    createdAt: 0,
    availableAt: 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
}

describe("backoff", () => {
  test("exponential growth capped at maxDelayMs", () => {
    expect(backoffSeries(6, opts)).toEqual([100, 200, 400, 800, 1000, 1000]);
  });

  test("defaults are exponential without jitter", () => {
    expect(backoffDelay(1, DEFAULT_BACKOFF)).toBe(100);
    expect(backoffDelay(3, DEFAULT_BACKOFF)).toBe(400);
  });

  test("attempt must be a positive integer", () => {
    expect(() => backoffDelay(0, opts)).toThrow(RangeError);
    expect(() => backoffDelay(1.5, opts)).toThrow(RangeError);
  });

  test("jitter is deterministic for a given seed and never exceeds the base delay", () => {
    const jittered: BackoffOptions = { ...opts, jitter: true };
    const a = backoffSeries(5, jittered, new Lcg(7));
    const b = backoffSeries(5, jittered, new Lcg(7));
    expect(a).toEqual(b);
    const plain = backoffSeries(5, opts);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!).toBeLessThanOrEqual(plain[i]!);
      expect(a[i]!).toBeGreaterThanOrEqual(Math.floor(plain[i]! / 2));
    }
  });

  test("retry budget", () => {
    expect(shouldRetry(task(1, 3))).toBe(true);
    expect(attemptsRemaining(task(1, 3))).toBe(2);
    expect(shouldRetry(task(3, 3))).toBe(false);
    expect(attemptsRemaining(task(5, 3))).toBe(0);
  });

  test("nextAvailableAt offsets from now", () => {
    expect(nextAvailableAt(500, 2, opts)).toBe(700);
  });
});
