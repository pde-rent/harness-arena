export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export class CollectingLogger implements Logger {
  private readonly entries: LogEntry[];
  private readonly bound: Record<string, unknown>;

  constructor(entries: LogEntry[] = [], bound: Record<string, unknown> = {}) {
    this.entries = entries;
    this.bound = bound;
  }

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.append("debug", message, fields);
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.append("info", message, fields);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.append("warn", message, fields);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.append("error", message, fields);
  }

  child(fields: Record<string, unknown>): Logger {
    return new CollectingLogger(this.entries, { ...this.bound, ...fields });
  }

  all(): LogEntry[] {
    return this.entries.slice();
  }

  byLevel(level: LogLevel): LogEntry[] {
    return this.entries.filter((entry) => entry.level === level);
  }

  messages(): string[] {
    return this.entries.map((entry) => entry.message);
  }

  clear(): void {
    this.entries.length = 0;
  }

  private append(
    level: LogLevel,
    message: string,
    fields: Record<string, unknown>,
  ): void {
    this.entries.push({ level, message, fields: { ...this.bound, ...fields } });
  }
}

export class NullLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

export function createLogger(): CollectingLogger {
  return new CollectingLogger();
}
