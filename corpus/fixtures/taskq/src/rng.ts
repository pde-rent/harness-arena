import type { Rng } from "./types";

const MODULUS = 2 ** 32;
const MULTIPLIER = 1664525;
const INCREMENT = 1013904223;

export class Lcg implements Rng {
  private state: number;

  constructor(seed = 1) {
    this.state = normalizeSeed(seed);
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, MULTIPLIER) + INCREMENT) >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.nextUint32() / MODULUS;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError("maxExclusive must be a positive integer");
    }
    return this.nextUint32() % maxExclusive;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = normalizeSeed(state);
  }

  clone(): Lcg {
    const copy = new Lcg(0);
    copy.setState(this.state);
    return copy;
  }
}

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new RangeError("seed must be finite");
  }
  return Math.floor(seed) >>> 0;
}

export function createRng(seed = 1): Rng {
  return new Lcg(seed);
}

export function sampleFloats(rng: Rng, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(rng.nextFloat());
  }
  return out;
}
