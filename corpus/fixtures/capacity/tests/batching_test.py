import unittest

from capacity.batching import batch_bytes, batches_per_second, events_per_batch
from capacity.ingest import (
    compressed_bytes_per_second,
    compressed_event_bytes,
    daily_compressed_bytes,
)
from tests.helpers import make_config


class CompressionTest(unittest.TestCase):
    def test_event_size_is_divided_by_the_ratio(self):
        self.assertEqual(compressed_event_bytes(1400, 3.5), 400.0)

    def test_throughput_rounds_up(self):
        self.assertEqual(compressed_bytes_per_second(3, 10, 4.0), 8)

    def test_daily_volume_rounds_up(self):
        self.assertEqual(daily_compressed_bytes(3, 10, 4.0), 8)


class BatchSizeTest(unittest.TestCase):
    def test_batch_closes_on_the_event_that_reaches_the_size_limit(self):
        # 256000 bytes / 400 bytes per event == exactly 640 events.
        cfg = make_config(batch_max_kib=250, batch_max_events=10000, compression_ratio=3.5)
        self.assertEqual(events_per_batch(cfg, 1400), 640)
        self.assertEqual(batch_bytes(cfg, 1400), 256000.0)

    def test_one_more_byte_of_limit_needs_one_more_event(self):
        cfg = make_config(batch_max_kib=250, batch_max_events=10000, compression_ratio=3.5)
        wider = cfg.replace(batch_max_kib=251)
        self.assertEqual(events_per_batch(wider, 1400), 643)

    def test_event_ceiling_can_bind_instead(self):
        cfg = make_config(batch_max_kib=250, batch_max_events=100, compression_ratio=3.5)
        self.assertEqual(events_per_batch(cfg, 1400), 100)


class BatchRateTest(unittest.TestCase):
    def test_batches_per_second_rounds_up(self):
        cfg = make_config(batch_max_kib=250, batch_max_events=10000, compression_ratio=3.5)
        self.assertEqual(batches_per_second(cfg, 640, 1400), 1)
        self.assertEqual(batches_per_second(cfg, 641, 1400), 2)


if __name__ == "__main__":
    unittest.main()
