import type { Clock, SleepFn } from "./types";

export interface SteppingClockOptions {
  start?: number;
  step?: number;
}

export class SteppingClock implements Clock {
  private current: number;
  private readonly step: number;

  constructor(options: SteppingClockOptions = {}) {
    this.current = options.start ?? 1_700_000_000_000;
    this.step = options.step ?? 1;
  }

  now(): number {
    const value = this.current;
    this.current += this.step;
    return value;
  }

  peek(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

export class FrozenClock implements Clock {
  constructor(private readonly value: number = 1_700_000_000_000) {}

  now(): number {
    return this.value;
  }
}

export function defaultClock(): Clock {
  return new SteppingClock();
}

export interface SleepRecorder {
  sleep: SleepFn;
  waits: number[];
}

export function createSleepRecorder(): SleepRecorder {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

export const noopSleep: SleepFn = async () => {};

export interface Rng {
  next(): number;
}

export class SeededRng implements Rng {
  private state: number;

  constructor(seed = 0x2f6e2b1) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    this.state = (this.state * 1_664_525 + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
}

export function defaultRng(): Rng {
  return new SeededRng();
}
