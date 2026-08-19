import type { Event, IssueSeverity, ValidationIssue } from "../types";

const CODE_PREFIX = "identity";

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

export const ID_MIN_LENGTH = 2;
export const ID_MAX_LENGTH = 64;

export function isIdCharacter(ch: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(ch);
}

export function hasValidIdShape(id: string): boolean {
  if (measure(id) < ID_MIN_LENGTH || measure(id) > ID_MAX_LENGTH) return false;
  for (let i = 0; i < id.length; i += 1) {
    if (!isIdCharacter(id.charAt(i))) return false;
  }
  return true;
}

export function normalizeSource(source: string): string {
  return source.trim().toLowerCase();
}

export function validateIdentity(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!hasValidIdShape(event.id)) {
    issues.push(
      errorIssue(
        "bad_id",
        "id",
        `id "${textOf(event.id)}" is not a valid identifier`,
      ),
    );
  }
  const source = normalizeSource(textOf(event.source));
  if (measure(source) === 0) {
    issues.push(errorIssue("missing_source", "source", "source is empty"));
  } else if (!source.includes(".")) {
    issues.push(
      warningIssue(
        "flat_source",
        "source",
        `source "${source}" is not namespaced`,
      ),
    );
  }
  return issues;
}
