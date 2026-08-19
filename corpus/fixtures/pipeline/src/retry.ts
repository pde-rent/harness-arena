import { noopSleep, defaultRng, type Rng } from "./clock";
import type { MetricsSink } from "./metrics";
import type { Logger } from "./log";
import type { Clock, SleepFn } from "./types";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 50,
  factor: 3,
  maxDelayMs: 1000,
  jitterRatio: 0,
};

export const AGGRESSIVE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  baseDelayMs: 10,
  factor: 2,
  maxDelayMs: 400,
  jitterRatio: 0,
};

export const CONSERVATIVE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 2,
  baseDelayMs: 100,
  factor: 4,
  maxDelayMs: 2000,
  jitterRatio: 0,
};

export interface RetryOptions {
  label?: string;
  sleep?: SleepFn;
  metrics?: MetricsSink;
  logger?: Logger;
  clock?: Clock;
  rng?: Rng;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface RetryAttemptFn<T> {
  (attempt: number): Promise<T> | T;
}

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly cause: unknown;

  constructor(label: string, attempts: number, cause: unknown) {
    super(`${label} failed after ${attempts} attempt(s)`);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

export function computeBackoffMs(policy: RetryPolicy, attempt: number): number {
  if (attempt < 1) return 0;
  const raw = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

export function applyJitter(
  policy: RetryPolicy,
  delayMs: number,
  rng: Rng,
): number {
  if (policy.jitterRatio <= 0) return delayMs;
  const span = delayMs * policy.jitterRatio;
  return Math.round(delayMs - span / 2 + span * rng.next());
}

export function backoffSchedule(policy: RetryPolicy): number[] {
  const out: number[] = [];
  for (let attempt = 1; attempt < policy.maxAttempts; attempt += 1) {
    out.push(computeBackoffMs(policy, attempt));
  }
  return out;
}

export function alwaysRetry(): boolean {
  return true;
}

export async function withRetry<T>(
  fn: RetryAttemptFn<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  opts: RetryOptions = {},
): Promise<T> {
  const label = opts.label ?? "retry";
  const sleep = opts.sleep ?? noopSleep;
  const rng = opts.rng ?? defaultRng();
  const shouldRetry = opts.shouldRetry ?? alwaysRetry;
  const metrics = opts.metrics;
  const startedAt = opts.clock?.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    metrics?.counter(`${label}.attempt`);
    try {
      const value = await fn(attempt);
      metrics?.counter(`${label}.success`);
      if (metrics && startedAt !== undefined && opts.clock) {
        metrics.timing(`${label}.duration`, opts.clock.now() - startedAt);
      }
      return value;
    } catch (error) {
      lastError = error;
      metrics?.counter(`${label}.failure`);
      opts.logger?.warn("retry attempt failed", { label, attempt });
      if (attempt >= policy.maxAttempts || !shouldRetry(error, attempt)) {
        break;
      }
      const delay = applyJitter(policy, computeBackoffMs(policy, attempt), rng);
      metrics?.counter(`${label}.backoff_ms`, delay);
      await sleep(delay);
    }
  }

  metrics?.counter(`${label}.exhausted`);
  throw new RetryExhaustedError(label, policy.maxAttempts, lastError);
}
