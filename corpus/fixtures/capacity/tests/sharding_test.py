import unittest

from capacity.sharding import plan_shards
from tests.helpers import make_config


class ShardTest(unittest.TestCase):
    def setUp(self):
        self.cfg = make_config(shard_max_events_per_second=4000, shard_max_mib_per_second=1.0)

    def test_both_ceilings_round_up(self):
        plan = plan_shards(self.cfg, 4001, 1)
        self.assertEqual(plan.shards_for_events, 2)
        self.assertEqual(plan.shards_for_bytes, 1)
        self.assertEqual(plan.shards, 2)

    def test_the_larger_ceiling_wins_and_is_reported(self):
        plan = plan_shards(self.cfg, 1000, 5 * 1048576)
        self.assertEqual(plan.shards, 5)
        self.assertEqual(plan.binding_limit_field, "shard_max_mib_per_second")

    def test_event_ceiling_reported_when_it_binds(self):
        plan = plan_shards(self.cfg, 40000, 1048576)
        self.assertEqual(plan.shards, 10)
        self.assertEqual(plan.binding_limit_field, "shard_max_events_per_second")

    def test_byte_ceiling_uses_mebibytes(self):
        plan = plan_shards(self.cfg, 1, 1048576)
        self.assertEqual(plan.shards_for_bytes, 1)
        self.assertEqual(plan_shards(self.cfg, 1, 1048577).shards_for_bytes, 2)


if __name__ == "__main__":
    unittest.main()
