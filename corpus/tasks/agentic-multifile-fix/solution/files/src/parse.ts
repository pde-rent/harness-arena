import { PipelineError, isEventKind, type EventBody, type EventKind, type ParsedEvent } from "./types";
import { canonicalizeId } from "./validate/identity";

export const HEADER_SEPARATOR = "|";
export const HEADER_FIELD_COUNT = 4;

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r";
}

function trimEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isWhitespace(value.charAt(start))) start += 1;
  while (end > start && isWhitespace(value.charAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

export function splitHeaderLine(raw: string): { header: string; body: string } {
  let cut = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charAt(i) === "\n") {
      cut = i;
      break;
    }
  }
  if (cut === -1) {
    return { header: trimEdges(raw), body: "" };
  }
  return { header: trimEdges(raw.slice(0, cut)), body: raw.slice(cut + 1) };
}

/** Canonical form of an event id, as it enters the pipeline. */
export function canonicalId(value: string): string {
  return canonicalizeId(value);
}

export function splitHeaderFields(header: string): string[] {
  const fields: string[] = [];
  let current = "";
  for (let i = 0; i < header.length; i += 1) {
    const ch = header.charAt(i);
    if (ch === HEADER_SEPARATOR) {
      fields.push(trimEdges(current));
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(trimEdges(current));
  return fields;
}

export function parseTimestamp(field: string): number {
  if (field.length === 0) {
    throw new PipelineError("parse", "timestamp field is empty");
  }
  let value = 0;
  for (let i = 0; i < field.length; i += 1) {
    const code = field.charCodeAt(i);
    if (code < 48 || code > 57) {
      throw new PipelineError("parse", `timestamp is not numeric: ${field}`);
    }
    value = value * 10 + (code - 48);
  }
  return value;
}

export function coerceKind(field: string): EventKind {
  const lowered = field.toLowerCase();
  return isEventKind(lowered) ? lowered : "unknown";
}

export function parseBody(body: string): EventBody {
  const trimmed = trimEdges(body).replace(/\n+$/, "");
  if (trimmed.length === 0) return {};
  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed);
  } catch {
    throw new PipelineError("parse", "body is not valid JSON");
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new PipelineError("parse", "body must be a JSON object");
  }
  return decoded as EventBody;
}

export function parseEvent(raw: string): ParsedEvent {
  if (trimEdges(raw).length === 0) {
    throw new PipelineError("parse", "empty payload");
  }
  const { header, body } = splitHeaderLine(raw);
  const fields = splitHeaderFields(header);
  if (fields.length !== HEADER_FIELD_COUNT) {
    throw new PipelineError(
      "parse",
      `expected ${HEADER_FIELD_COUNT} header fields, got ${fields.length}`,
    );
  }
  const [kindField, idField, tsField, sourceField] = fields as [
    string,
    string,
    string,
    string,
  ];
  if (idField.length === 0) {
    throw new PipelineError("parse", "id field is empty");
  }
  const parsedBody = parseBody(body);
  return {
    kind: coerceKind(kindField),
    id: canonicalId(idField),
    timestamp: parseTimestamp(tsField),
    source: sourceField,
    body: parsedBody,
    raw,
    headerFieldCount: fields.length,
    bodyBytes: trimEdges(body).length,
  };
}

export function tryParseEvent(raw: string): ParsedEvent | undefined {
  try {
    return parseEvent(raw);
  } catch {
    return undefined;
  }
}

export function formatEvent(event: {
  kind: EventKind;
  id: string;
  timestamp: number;
  source: string;
  body: EventBody;
}): string {
  const header = [event.kind, event.id, String(event.timestamp), event.source].join(
    HEADER_SEPARATOR,
  );
  return `${header}\n${JSON.stringify(event.body)}`;
}
