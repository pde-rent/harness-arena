export interface TimingSummary {
  count: number;
  total: number;
  min: number;
  max: number;
}

export class MetricsSink {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, TimingSummary>();

  counter(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  timing(name: string, ms: number): void {
    const existing = this.timings.get(name);
    if (!existing) {
      this.timings.set(name, { count: 1, total: ms, min: ms, max: ms });
      return;
    }
    existing.count += 1;
    existing.total += ms;
    if (ms < existing.min) existing.min = ms;
    if (ms > existing.max) existing.max = ms;
  }

  read(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  timingFor(name: string): TimingSummary | undefined {
    const summary = this.timings.get(name);
    return summary ? { ...summary } : undefined;
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, value] of this.counters) {
      out[name] = value;
    }
    for (const [name, summary] of this.timings) {
      out[`${name}.count`] = summary.count;
      out[`${name}.total`] = summary.total;
      out[`${name}.max`] = summary.max;
    }
    const sorted: Record<string, number> = {};
    for (const key of Object.keys(out).sort()) {
      sorted[key] = out[key] as number;
    }
    return sorted;
  }

  names(): string[] {
    return Object.keys(this.snapshot());
  }

  reset(): void {
    this.counters.clear();
    this.timings.clear();
  }
}

export function mergeSinks(target: MetricsSink, source: MetricsSink): void {
  for (const [name, value] of Object.entries(source.snapshot())) {
    target.counter(name, value);
  }
}
