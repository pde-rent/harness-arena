import type { Event, EventKind, ValidationIssue } from "../types";

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

function missingField(field: string): ValidationIssue {
  return {
    code: "schema.missing_field",
    field,
    message: `required field "${field}" is absent`,
    severity: "error",
  };
}

function badType(field: string, expected: string): ValidationIssue {
  return {
    code: "schema.bad_type",
    field,
    message: `field "${field}" must be ${expected}`,
    severity: "error",
  };
}

export function validateSchema(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const field of requiredFieldsFor(event.kind)) {
    if (!(field in event.body) || event.body[field] === undefined) {
      issues.push(missingField(field));
    }
  }
  for (const field of NUMERIC_FIELDS[event.kind] ?? []) {
    const value = event.body[field];
    if (value !== undefined && typeof value !== "number") {
      issues.push(badType(field, "a number"));
    }
  }
  if (event.kind === "unknown") {
    issues.push({
      code: "schema.unknown_kind",
      field: "kind",
      message: "event kind is not recognised",
      severity: "warning",
    });
  }
  return issues;
}
