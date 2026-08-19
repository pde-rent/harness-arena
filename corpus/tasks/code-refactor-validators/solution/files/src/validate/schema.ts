import type { Event, EventKind, ValidationIssue } from "../types";
import { fieldValue, hasField, issueFactory, textOf } from "./issues";

const issue = issueFactory("schema");

const REQUIRED_FIELDS: Record<EventKind, string[]> = {
  audit: ["actor", "action"],
  metric: ["name", "value"],
  alert: ["severity", "summary"],
  trace: ["traceId", "spanId"],
  unknown: [],
};

const NUMERIC_FIELDS: Record<string, string[]> = {
  metric: ["value"],
  trace: ["durationMs"],
};

export function requiredFieldsFor(kind: EventKind): string[] {
  return (REQUIRED_FIELDS[kind] ?? []).slice();
}

export function validateSchema(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of requiredFieldsFor(event.kind)) {
    if (!hasField(event, field)) {
      issues.push(
        issue.error("missing_field", field, `required field "${textOf(field)}" is absent`),
      );
    }
  }
  for (const field of NUMERIC_FIELDS[event.kind] ?? []) {
    const value = fieldValue(event, field);
    if (value !== undefined && typeof value !== "number") {
      issues.push(
        issue.error("bad_type", field, `field "${textOf(field)}" must be a number`),
      );
    }
  }
  if (event.kind === "unknown") {
    issues.push(issue.warning("unknown_kind", "kind", "event kind is not recognised"));
  }
  return issues;
}
