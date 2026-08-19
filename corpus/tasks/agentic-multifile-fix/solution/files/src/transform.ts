import { canonicalizeId, normalizeSource } from "./validate/identity";
import type { Clock, Event, EventBody, ParsedEvent } from "./types";

export const ENVELOPE_PREFIX = "_";

export function stripEnvelopeKeys(body: EventBody): EventBody {
  const out: EventBody = {};
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith(ENVELOPE_PREFIX)) continue;
    out[key] = value;
  }
  return out;
}

export function normalizeKeys(body: EventBody): EventBody {
  const out: EventBody = {};
  for (const key of Object.keys(body).sort()) {
    out[key.trim()] = body[key];
  }
  return out;
}

/** Canonical form of an event id, as it is handed to handlers and stored. */
export function normalizeId(id: string): string {
  return canonicalizeId(id);
}

export function normalizeEvent(event: ParsedEvent | Event): Event {
  return {
    kind: event.kind,
    id: normalizeId(event.id),
    timestamp: event.timestamp,
    source: normalizeSource(event.source),
    body: normalizeKeys(stripEnvelopeKeys(event.body)),
  };
}

export interface EnrichOptions {
  clock?: Clock;
  pipelineVersion?: string;
  tags?: Record<string, string>;
}

export const PIPELINE_VERSION = "3.1.0";

export function enrichEvent(event: Event, options: EnrichOptions = {}): Event {
  const body: EventBody = { ...event.body };
  body._version = options.pipelineVersion ?? PIPELINE_VERSION;
  body._sourceRoot = sourceRoot(event.source);
  if (options.clock) {
    body._receivedAt = options.clock.now();
  }
  for (const [key, value] of Object.entries(options.tags ?? {})) {
    body[`_tag_${key}`] = value;
  }
  return { ...event, body };
}

export function sourceRoot(source: string): string {
  const dot = source.indexOf(".");
  return dot === -1 ? source : source.slice(0, dot);
}

export function transformEvent(
  event: ParsedEvent | Event,
  options: EnrichOptions = {},
): Event {
  return enrichEvent(normalizeEvent(event), options);
}

export function projectBody(event: Event, fields: string[]): EventBody {
  const out: EventBody = {};
  for (const field of fields) {
    if (field in event.body) {
      out[field] = event.body[field];
    }
  }
  return out;
}
