import type { Event, ValidationIssue } from "../types";

export const ID_MIN_LENGTH = 2;
export const ID_MAX_LENGTH = 64;

export function isIdCharacter(ch: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(ch);
}

export function hasValidIdShape(id: string): boolean {
  if (id.length < ID_MIN_LENGTH || id.length > ID_MAX_LENGTH) return false;
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
    issues.push({
      code: "identity.bad_id",
      field: "id",
      message: `id "${event.id}" is not a valid identifier`,
      severity: "error",
    });
  }
  const source = normalizeSource(event.source);
  if (source.length === 0) {
    issues.push({
      code: "identity.missing_source",
      field: "source",
      message: "source is empty",
      severity: "error",
    });
  } else if (!source.includes(".")) {
    issues.push({
      code: "identity.flat_source",
      field: "source",
      message: `source "${source}" is not namespaced`,
      severity: "warning",
    });
  }
  return issues;
}
