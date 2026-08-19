"""Turning an event rate into a byte rate.

Compression happens on the collector, before batching and before anything is
written to a shard, so every byte figure downstream of here is a
*post-compression* byte figure.
"""

from __future__ import annotations

import math


def compressed_event_bytes(avg_payload_bytes: int, compression_ratio: float) -> float:
    """Post-compression size of one average event, in bytes.

    Deliberately not rounded: batches hold hundreds of events and rounding here
    would drift by kilobytes per batch.
    """
    if compression_ratio <= 0:
        raise ValueError("compression_ratio must be positive")
    return avg_payload_bytes / compression_ratio


def compressed_bytes_per_second(
    events_per_second: int, avg_payload_bytes: int, compression_ratio: float
) -> int:
    """Post-compression ingest throughput, rounded up to a whole byte per second."""
    return math.ceil(events_per_second * avg_payload_bytes / compression_ratio)


def daily_compressed_bytes(
    daily_events: int, avg_payload_bytes: int, compression_ratio: float
) -> int:
    """Post-compression bytes produced over one day, rounded up to a whole byte."""
    return math.ceil(daily_events * avg_payload_bytes / compression_ratio)
