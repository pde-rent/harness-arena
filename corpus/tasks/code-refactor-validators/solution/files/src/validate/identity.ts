import type { Event, ValidationIssue } from "../types";
import { issueFactory, measure, textOf } from "./issues";

const issue = issueFactory("identity");

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
      issue.error("bad_id", "id", `id "${textOf(event.id)}" is not a valid identifier`),
    );
  }
  const source = normalizeSource(textOf(event.source));
  if (measure(source) === 0) {
    issues.push(issue.error("missing_source", "source", "source is empty"));
  } else if (!source.includes(".")) {
    issues.push(
      issue.warning("flat_source", "source", `source "${source}" is not namespaced`),
    );
  }
  return issues;
}
