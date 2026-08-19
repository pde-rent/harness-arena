import type { Event, IssueSeverity, ValidationIssue } from "../types";

export function makeIssue(
  prefix: string,
  code: string,
  field: string,
  message: string,
  severity: IssueSeverity,
): ValidationIssue {
  return { code: `${prefix}.${code}`, field, message, severity };
}

export function issueFactory(prefix: string) {
  return {
    error: (code: string, field: string, message: string) =>
      makeIssue(prefix, code, field, message, "error"),
    warning: (code: string, field: string, message: string) =>
      makeIssue(prefix, code, field, message, "warning"),
  };
}

export function fieldValue(event: Event, field: string): unknown {
  if (!(field in event.body)) return undefined;
  return event.body[field];
}

export function hasField(event: Event, field: string): boolean {
  return fieldValue(event, field) !== undefined;
}

export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

export function measure(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length;
  }
  return 0;
}
