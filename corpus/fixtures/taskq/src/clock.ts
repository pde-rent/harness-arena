import type { Clock } from "./types";

export class ManualClock implements Clock {
  private time: number;

  constructor(start = 0) {
    if (!Number.isFinite(start)) {
      throw new RangeError("clock start must be finite");
    }
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms)) {
      throw new RangeError("advance requires a finite duration");
    }
    if (ms < 0) {
      throw new RangeError("advance cannot move backwards");
    }
    this.time += ms;
    return this.time;
  }

  setTime(time: number): number {
    if (!Number.isFinite(time)) {
      throw new RangeError("time must be finite");
    }
    if (time < this.time) {
      throw new RangeError("time cannot move backwards");
    }
    this.time = time;
    return this.time;
  }
}

export function fixedClock(time: number): Clock {
  return { now: () => time };
}
