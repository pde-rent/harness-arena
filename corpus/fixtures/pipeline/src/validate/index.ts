import type { MetricsSink } from "../metrics";
import type { Event, ValidationIssue } from "../types";
import { validateIdentity } from "./identity";
import { validateLimits } from "./limits";
import { validateSchema } from "./schema";

export type Validator = (event: Event) => ValidationIssue[];

export interface NamedValidator {
  name: string;
  run: Validator;
}

export const CORE_VALIDATORS: NamedValidator[] = [
  { name: "schema", run: validateSchema },
  { name: "limits", run: validateLimits },
  { name: "identity", run: validateIdentity },
];

export interface ValidateOptions {
  metrics?: MetricsSink;
  validators?: NamedValidator[];
}

export function runValidators(
  event: Event,
  options: ValidateOptions = {},
): ValidationIssue[] {
  const validators = options.validators ?? CORE_VALIDATORS;
  const issues: ValidationIssue[] = [];
  for (const validator of validators) {
    const produced = validator.run(event);
    if (produced.length > 0) {
      options.metrics?.counter(`validate.${validator.name}.issues`, produced.length);
    }
    for (const issue of produced) {
      issues.push(issue);
    }
  }
  options.metrics?.counter("validate.runs");
  return issues;
}

export function errorsOf(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function warningsOf(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "warning");
}

export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return errorsOf(issues).length > 0;
}

export function summarizeIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return "clean";
  return issues
    .map((issue) => `${issue.severity}:${issue.code}`)
    .sort()
    .join(",");
}

export { validateIdentity, validateLimits, validateSchema };
