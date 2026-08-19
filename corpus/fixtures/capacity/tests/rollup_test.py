import unittest

from capacity.pricing import within_budget
from capacity.rollup import build_plan, max_retention_days_within_budget
from tests.helpers import make_config, samples


class PlanTest(unittest.TestCase):
    """The rollup is checked against hand-built traffic, not against conf/ or data/."""

    def setUp(self):
        self.cfg = make_config(
            compression_ratio=2.0,
            batch_max_kib=1,
            batch_max_events=10000,
            shard_max_events_per_second=1,
            shard_max_mib_per_second=1.0,
            retention_days=1,
            replication_factor=2,
        )
        # two hours, 3600 events each, 1024-byte payloads
        self.rows = samples([3600, 3600], payload_per_event=1024)

    def test_chain(self):
        plan = build_plan(self.cfg, self.rows)
        self.assertEqual(plan.peak_events_per_second, 1)
        self.assertEqual(plan.avg_payload_bytes, 1024)
        self.assertEqual(plan.compressed_peak_bytes_per_second, 512)
        self.assertEqual(plan.events_per_batch, 2)  # 1024 bytes / 512 bytes per event
        self.assertEqual(plan.batches_per_second, 1)
        self.assertEqual(plan.shards.shards, 1)
        self.assertEqual(plan.retention_window_days, 2)
        # 7200 events * 1024 / 2 == 3686400 bytes/day, 2 days resident, 2 replicas
        self.assertEqual(plan.hot_tier_bytes, 3686400 * 2 * 2)
        self.assertEqual(plan.hot_tier_gib, 1)

    def test_loadtest_traffic_is_excluded(self):
        noisy = self.rows + samples([360000], fleet="loadtest", payload_per_event=4096)
        self.assertEqual(build_plan(self.cfg, noisy), build_plan(self.cfg, self.rows))

    def test_budget_search_finds_the_last_affordable_day(self):
        cfg = self.cfg.replace(
            hot_tier_free_gib=0,
            price_tiers=((None, "1.00"),),
            shard_monthly_usd="0.00",
            monthly_budget_usd="3.00",
        )
        rows = samples([3600] * 24, payload_per_event=1024)
        shards = build_plan(cfg, rows).shards.shards
        days = max_retention_days_within_budget(cfg, rows)
        self.assertIsInstance(days, int)
        self.assertGreaterEqual(days, 0)
        affordable = build_plan(cfg.replace(retention_days=days), rows)
        self.assertTrue(within_budget(cfg, affordable.hot_tier_gib, shards))
        one_more = build_plan(cfg.replace(retention_days=days + 1), rows)
        self.assertFalse(within_budget(cfg, one_more.hot_tier_gib, shards))


if __name__ == "__main__":
    unittest.main()
