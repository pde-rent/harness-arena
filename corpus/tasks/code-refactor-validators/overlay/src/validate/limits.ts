import type { Event, IssueSeverity, ValidationIssue } from "../types";

const CODE_PREFIX = "limits";

function prefixCode(code: string): string {
  return `${CODE_PREFIX}.${code}`;
}

function makeIssue(
  code: string,
  field: string,
  message: string,
  severity: IssueSeverity,
): ValidationIssue {
  return {
    code: prefixCode(code),
    field,
    message,
    severity,
  };
}

function errorIssue(
  code: string,
  field: string,
  message: string,
): ValidationIssue {
  return makeIssue(code, field, message, "error");
}

function warningIssue(
  code: string,
  field: string,
  message: string,
): ValidationIssue {
  return makeIssue(code, field, message, "warning");
}

function fieldValue(event: Event, field: string): unknown {
  if (!(field in event.body)) return undefined;
  return event.body[field];
}

function hasField(event: Event, field: string): boolean {
  return fieldValue(event, field) !== undefined;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function measure(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
}

export const MAX_BODY_KEYS = 32;
export const MAX_STRING_LENGTH = 512;
export const MIN_TIMESTAMP = 1_000_000_000;

export function countBodyKeys(event: Event): number {
  return measure(event.body);
}

export function longestStringLength(event: Event): number {
  let longest = 0;
  for (const value of Object.values(event.body)) {
    if (typeof value === "string" && measure(value) > longest) {
      longest = measure(value);
    }
  }
  return longest;
}

export function validateLimits(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const keyCount = countBodyKeys(event);
  if (keyCount > MAX_BODY_KEYS) {
    issues.push(
      errorIssue(
        "too_many_keys",
        "body",
        `body has ${keyCount} keys, limit is ${MAX_BODY_KEYS}`,
      ),
    );
  }
  const longest = longestStringLength(event);
  if (longest > MAX_STRING_LENGTH) {
    issues.push(
      warningIssue(
        "string_too_long",
        "body",
        `body contains a string of ${longest} characters`,
      ),
    );
  }
  if (event.timestamp < MIN_TIMESTAMP) {
    issues.push(
      errorIssue(
        "timestamp_too_old",
        "timestamp",
        `timestamp ${event.timestamp} predates the accepted window`,
      ),
    );
  }
  return issues;
}
