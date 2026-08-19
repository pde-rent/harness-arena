import type { Event, ValidationIssue } from "../types";
import { issueFactory, measure } from "./issues";

const issue = issueFactory("limits");

export const MAX_BODY_KEYS = 32;
export const MAX_STRING_LENGTH = 512;
export const MIN_TIMESTAMP = 1_000_000_000;

export function countBodyKeys(event: Event): number {
  return measure(event.body);
}

export function longestStringLength(event: Event): number {
  let longest = 0;
  for (const value of Object.values(event.body)) {
    if (typeof value === "string" && measure(value) > longest) longest = measure(value);
  }
  return longest;
}

export function validateLimits(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keyCount = countBodyKeys(event);
  if (keyCount > MAX_BODY_KEYS) {
    issues.push(
      issue.error("too_many_keys", "body", `body has ${keyCount} keys, limit is ${MAX_BODY_KEYS}`),
    );
  }
  const longest = longestStringLength(event);
  if (longest > MAX_STRING_LENGTH) {
    issues.push(
      issue.warning("string_too_long", "body", `body contains a string of ${longest} characters`),
    );
  }
  if (event.timestamp < MIN_TIMESTAMP) {
    issues.push(
      issue.error(
        "timestamp_too_old",
        "timestamp",
        `timestamp ${event.timestamp} predates the accepted window`,
      ),
    );
  }
  return issues;
}
