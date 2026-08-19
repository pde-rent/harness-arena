import type {
  Event,
  EventKind,
  IssueSeverity,
  ValidationIssue,
} from "../types";

const CODE_PREFIX = "schema";

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
        errorIssue(
          "missing_field",
          field,
          `required field "${textOf(field)}" is absent`,
        ),
      );
    }
  }
  for (const field of NUMERIC_FIELDS[event.kind] ?? []) {
    const value = fieldValue(event, field);
    if (value !== undefined && typeof value !== "number") {
      issues.push(
        errorIssue("bad_type", field, `field "${textOf(field)}" must be a number`),
      );
    }
  }
  if (event.kind === "unknown") {
    issues.push(
      warningIssue("unknown_kind", "kind", "event kind is not recognised"),
    );
  }
  return issues;
}
