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

/**
 * The one canonical form of an event id: surrounding whitespace trimmed,
 * upper cased. Every site that derives, validates, stores or compares an id
 * goes through this.
 */
export function canonicalizeId(id: string): string {
  return id.trim().toUpperCase();
}

export function normalizeSource(source: string): string {
  return source.trim().toLowerCase();
}

export function validateIdentity(event: Event): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = canonicalizeId(event.id);
  if (!hasValidIdShape(id)) {
    issues.push({
      code: "identity.bad_id",
      field: "id",
      message: `id "${id}" is not a valid identifier`,
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
