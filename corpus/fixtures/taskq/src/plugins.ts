import type { HookEventMap, HookName, Plugin } from "./types";

export const HOOK_NAMES: readonly HookName[] = [
  "onEnqueue",
  "onStart",
  "onComplete",
  "onFail",
];

export interface PluginError {
  plugin: string;
  hook: HookName;
  message: string;
}

interface Registration {
  plugin: Plugin;
  order: number;
  index: number;
}

export class DuplicatePluginError extends Error {
  constructor(name: string) {
    super(`plugin already registered: ${name}`);
    this.name = "DuplicatePluginError";
  }
}

export class PluginRegistry {
  private readonly registrations: Registration[] = [];
  private readonly errorLog: PluginError[] = [];
  private counter = 0;

  get size(): number {
    return this.registrations.length;
  }

  register(plugin: Plugin): void {
    if (this.registrations.some((entry) => entry.plugin.name === plugin.name)) {
      throw new DuplicatePluginError(plugin.name);
    }
    this.registrations.push({
      plugin,
      order: plugin.order ?? 0,
      index: this.counter,
    });
    this.counter += 1;
  }

  registerAll(plugins: Plugin[]): void {
    for (const plugin of plugins) this.register(plugin);
  }

  unregister(name: string): boolean {
    const at = this.registrations.findIndex((entry) => entry.plugin.name === name);
    if (at < 0) return false;
    this.registrations.splice(at, 1);
    return true;
  }

  has(name: string): boolean {
    return this.registrations.some((entry) => entry.plugin.name === name);
  }

  names(): string[] {
    return this.sorted().map((entry) => entry.plugin.name);
  }

  listeners(hook: HookName): string[] {
    return this.sorted()
      .filter((entry) => typeof entry.plugin[hook] === "function")
      .map((entry) => entry.plugin.name);
  }

  errors(): PluginError[] {
    return [...this.errorLog];
  }

  clearErrors(): void {
    this.errorLog.length = 0;
  }

  emit<K extends HookName>(hook: K, event: HookEventMap[K]): number {
    let delivered = 0;
    for (const entry of this.sorted()) {
      const listener = entry.plugin[hook];
      if (typeof listener !== "function") continue;
      try {
        (listener as (arg: HookEventMap[K]) => void).call(entry.plugin, event);
        delivered += 1;
      } catch (error) {
        this.errorLog.push({
          plugin: entry.plugin.name,
          hook,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return delivered;
  }

  private sorted(): Registration[] {
    return [...this.registrations].sort((a, b) =>
      a.order !== b.order ? a.order - b.order : a.index - b.index,
    );
  }
}

export function recordingPlugin(
  name: string,
  sink: string[],
  order?: number,
): Plugin {
  return {
    name,
    order,
    onEnqueue: (event) => sink.push(`${name}:onEnqueue:${event.task.id}`),
    onStart: (event) => sink.push(`${name}:onStart:${event.task.id}`),
    onComplete: (event) => sink.push(`${name}:onComplete:${event.task.id}`),
    onFail: (event) => sink.push(`${name}:onFail:${event.task.id}`),
  };
}
