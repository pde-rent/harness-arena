import type { MetricsSink } from "../metrics";
import type { Event, Handler, HandlerContext, HandlerOutput } from "../types";

export const METRIC_NAMESPACE = "metric";

export function metricName(event: Event): string {
  const raw = String(event.body.name ?? "unnamed");
  return raw.replace(/[^A-Za-z0-9_.]/g, "_");
}

export function metricValue(event: Event): number {
  const value = event.body.value;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function recordSample(sink: MetricsSink, event: Event): number {
  const name = metricName(event);
  const value = metricValue(event);
  const unit = String(event.body.unit ?? "count");
  if (unit === "ms") {
    sink.timing(`sample.${name}`, value);
  } else {
    sink.counter(`sample.${name}`, value);
  }
  return value;
}

function rollUp(event: Event, ctx: HandlerContext): Record<string, unknown> {
  const key = `${event.source}/${metricName(event)}`;
  const previous = ctx.store.get(METRIC_NAMESPACE, key);
  const count = Number(previous?.count ?? 0) + 1;
  const total = Number(previous?.total ?? 0) + metricValue(event);
  const rolled = { key, count, total, last: event.timestamp };
  ctx.store.put(METRIC_NAMESPACE, key, rolled);
  return rolled;
}

export const metricHandler: Handler = async (
  event,
  ctx,
): Promise<HandlerOutput> => {
  const value = recordSample(ctx.metrics, event);
  const rolled = rollUp(event, ctx);
  ctx.logger.debug("metric absorbed", { id: event.id, value });
  return {
    handler: "metric",
    accepted: true,
    detail: { name: metricName(event), value, rollup: rolled },
  };
};
