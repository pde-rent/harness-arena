import type { Event, ValidationIssue } from "../types";

export const MAX_BODY_KEYS = 32;
export const MAX_STRING_LENGTH = 512;
export const MIN_TIMESTAMP = 1_000_000_000;

export function countBodyKeys(event: Event): number {
  return Object.keys(event.body).length;
}

export function longestStringLength(event: Event): number {
  let longest = 0;
  for (const value of Object.values(event.body)) {
    if (typeof value === "string" && value.length > longest) {
      longest = value.length;
    }
  }
  return longest;
}

export function validateLimits(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keyCount = countBodyKeys(event);
  if (keyCount > MAX_BODY_KEYS) {
    issues.push({
      code: "limits.too_many_keys",
      field: "body",
      message: `body has ${keyCount} keys, limit is ${MAX_BODY_KEYS}`,
      severity: "error",
    });
  }
  const longest = longestStringLength(event);
  if (longest > MAX_STRING_LENGTH) {
    issues.push({
      code: "limits.string_too_long",
      field: "body",
      message: `body contains a string of ${longest} characters`,
      severity: "warning",
    });
  }
  if (event.timestamp < MIN_TIMESTAMP) {
    issues.push({
      code: "limits.timestamp_too_old",
      field: "timestamp",
      message: `timestamp ${event.timestamp} predates the accepted window`,
      severity: "error",
    });
  }
  return issues;
}
