"""Batching.

The collector appends events to an open batch one at a time. After each append
it checks both limits and closes the batch when either one is *reached*:

* the accumulated post-compression size is **greater than or equal to**
  ``batch_max_bytes`` (``batch_max_kib`` KiB), or
* the number of events in the batch is **greater than or equal to**
  ``batch_max_events``.

Reaching the limit exactly therefore closes the batch on that event, it does not
wait for the next one.
"""

from __future__ import annotations

import math

from .config import PlannerConfig
from .ingest import compressed_event_bytes


def events_per_batch(cfg: PlannerConfig, avg_payload_bytes: int) -> int:
    """How many average events fit in one batch before it is closed."""
    per_event = compressed_event_bytes(avg_payload_bytes, cfg.compression_ratio)
    limit = cfg.batch_max_bytes
    n = 1
    while n * per_event < limit and n < cfg.batch_max_events:
        n += 1
    return n


def batch_bytes(cfg: PlannerConfig, avg_payload_bytes: int) -> float:
    """Post-compression size of a closed batch, in bytes."""
    return events_per_batch(cfg, avg_payload_bytes) * compressed_event_bytes(
        avg_payload_bytes, cfg.compression_ratio
    )


def batches_per_second(cfg: PlannerConfig, events_per_second: int, avg_payload_bytes: int) -> int:
    """Batches produced per second at the given event rate.

    Rounded up: a partially filled batch is still flushed and still costs a
    round trip to the broker.
    """
    return math.ceil(events_per_second / events_per_batch(cfg, avg_payload_bytes))
