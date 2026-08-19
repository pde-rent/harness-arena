export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TaskState =
  | "pending"
  | "ready"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export const TERMINAL_STATES: readonly TaskState[] = [
  "done",
  "failed",
  "cancelled",
];

export interface Task {
  id: string;
  seq: number;
  priority: number;
  deps: string[];
  handler: string | null;
  payload: JsonValue;
  state: TaskState;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  availableAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  result: JsonValue;
  error: string | null;
}

export interface TaskSpec {
  id: string;
  priority?: number;
  deps?: string[];
  handler?: string;
  payload?: JsonValue;
  maxAttempts?: number;
  availableAt?: number;
}

export type TaskOutcome =
  | { ok: true; value?: JsonValue }
  | { ok: false; error: string };

export interface TaskContext {
  task: Task;
  attempt: number;
  now: number;
  random(): number;
}

export type TaskHandler = (ctx: TaskContext) => TaskOutcome;

export interface Clock {
  now(): number;
  advance?(ms: number): void;
}

export interface Rng {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(maxExclusive: number): number;
  getState(): number;
  setState(state: number): void;
}

export interface BackoffOptions {
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
  jitter: boolean;
}

export interface EnqueueEvent {
  task: Task;
  at: number;
}

export interface StartEvent {
  task: Task;
  attempt: number;
  at: number;
}

export interface CompleteEvent {
  task: Task;
  result: JsonValue;
  at: number;
}

export interface FailEvent {
  task: Task;
  error: string;
  attempt: number;
  willRetry: boolean;
  retryAt: number | null;
  at: number;
}

export interface Plugin {
  name: string;
  order?: number;
  onEnqueue?(event: EnqueueEvent): void;
  onStart?(event: StartEvent): void;
  onComplete?(event: CompleteEvent): void;
  onFail?(event: FailEvent): void;
}

export type HookName = "onEnqueue" | "onStart" | "onComplete" | "onFail";

export interface HookEventMap {
  onEnqueue: EnqueueEvent;
  onStart: StartEvent;
  onComplete: CompleteEvent;
  onFail: FailEvent;
}

export interface QueueOptions {
  clock: Clock;
  seed?: number;
  handlers?: Record<string, TaskHandler>;
  plugins?: Plugin[];
  defaultPriority?: number;
  defaultMaxAttempts?: number;
  backoff?: Partial<BackoffOptions>;
  failDependentsOnFailure?: boolean;
}

export interface ResolvedQueueOptions {
  clock: Clock;
  seed: number;
  handlers: Record<string, TaskHandler>;
  defaultPriority: number;
  defaultMaxAttempts: number;
  backoff: BackoffOptions;
  failDependentsOnFailure: boolean;
}

export type TickOutcome =
  | { kind: "idle"; at: number }
  | {
      kind: "ran";
      at: number;
      taskId: string;
      state: TaskState;
      attempt: number;
      willRetry: boolean;
      cascaded: string[];
    };

export interface StateCounts {
  pending: number;
  ready: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseDelayMs: 100,
  factor: 2,
  maxDelayMs: 30_000,
  jitter: false,
};

export function resolveOptions(options: QueueOptions): ResolvedQueueOptions {
  return {
    clock: options.clock,
    seed: options.seed ?? 1,
    handlers: options.handlers ?? {},
    defaultPriority: options.defaultPriority ?? 0,
    defaultMaxAttempts: options.defaultMaxAttempts ?? 1,
    backoff: { ...DEFAULT_BACKOFF, ...(options.backoff ?? {}) },
    failDependentsOnFailure: options.failDependentsOnFailure ?? true,
  };
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}
