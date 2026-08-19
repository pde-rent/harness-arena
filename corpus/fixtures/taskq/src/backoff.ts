import type { BackoffOptions, Rng, Task } from "./types";

export function backoffDelay(
  attempt: number,
  options: BackoffOptions,
  rng?: Rng,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("attempt must be a positive integer");
  }
  const raw = options.baseDelayMs * options.factor ** (attempt - 1);
  const capped = Math.min(raw, options.maxDelayMs);
  const bounded = Math.max(0, Math.floor(capped));
  if (!options.jitter) return bounded;
  const factor = rng === undefined ? 1 : 0.5 + rng.nextFloat() / 2;
  return Math.max(0, Math.floor(bounded * factor));
}

export function backoffSeries(
  count: number,
  options: BackoffOptions,
  rng?: Rng,
): number[] {
  const out: number[] = [];
  for (let attempt = 1; attempt <= count; attempt += 1) {
    out.push(backoffDelay(attempt, options, rng));
  }
  return out;
}

export function attemptsRemaining(task: Task): number {
  return Math.max(0, task.maxAttempts - task.attempts);
}

export function shouldRetry(task: Task): boolean {
  return attemptsRemaining(task) > 0;
}

export function nextAvailableAt(
  now: number,
  attempt: number,
  options: BackoffOptions,
  rng?: Rng,
): number {
  return now + backoffDelay(attempt, options, rng);
}
