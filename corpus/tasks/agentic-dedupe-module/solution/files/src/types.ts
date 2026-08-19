export type EventKind = "audit" | "metric" | "alert" | "trace" | "unknown";

export const EVENT_KINDS: readonly EventKind[] = [
  "audit",
  "metric",
  "alert",
  "trace",
  "unknown",
];

export type EventBody = Record<string, unknown>;

export interface Event {
  kind: EventKind;
  id: string;
  timestamp: number;
  source: string;
  body: EventBody;
}

export interface ParsedEvent extends Event {
  raw: string;
  headerFieldCount: number;
  bodyBytes: number;
}

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  code: string;
  field: string;
  message: string;
  severity: IssueSeverity;
}

export type PipelineStage =
  | "parse"
  | "validate"
  | "transform"
  | "resolve"
  | "handle"
  | "duplicate"
  | "done";

export interface HandlerOutput {
  handler: string;
  accepted: boolean;
  detail: Record<string, unknown>;
}

export interface PipelineResult {
  ok: boolean;
  stage: PipelineStage;
  kind: EventKind;
  id: string;
  issues: ValidationIssue[];
  output?: HandlerOutput;
  error?: string;
}

export interface Clock {
  now(): number;
}

export type SleepFn = (ms: number) => Promise<void>;

export interface RecordStore {
  put(namespace: string, key: string, value: Record<string, unknown>): void;
  get(namespace: string, key: string): Record<string, unknown> | undefined;
  keys(namespace: string): string[];
  size(): number;
}

export interface HandlerContext {
  logger: import("./log").Logger;
  metrics: import("./metrics").MetricsSink;
  clock: Clock;
  sleep: SleepFn;
  store: RecordStore;
}

export type Handler = (
  event: Event,
  ctx: HandlerContext,
) => Promise<HandlerOutput>;

export class PipelineError extends Error {
  readonly stage: PipelineStage;

  constructor(stage: PipelineStage, message: string) {
    super(message);
    this.name = "PipelineError";
    this.stage = stage;
  }
}

export function isEventKind(value: string): value is EventKind {
  for (const kind of EVENT_KINDS) {
    if (kind === value) return true;
  }
  return false;
}

export function emptyBody(): EventBody {
  return {};
}
