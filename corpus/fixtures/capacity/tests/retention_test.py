import unittest

from capacity.retention import hot_tier_bytes, retention_window_days, to_gib
from tests.helpers import make_config


class WindowTest(unittest.TestCase):
    def test_the_day_in_progress_is_resident_on_top_of_the_history(self):
        self.assertEqual(retention_window_days(make_config(retention_days=7)), 8)
        self.assertEqual(retention_window_days(make_config(retention_days=0)), 1)

    def test_replication_multiplies_every_retained_byte(self):
        cfg = make_config(retention_days=1, replication_factor=3)
        self.assertEqual(hot_tier_bytes(cfg, 100), 100 * 2 * 3)


class GibTest(unittest.TestCase):
    def test_gib_is_base_two(self):
        self.assertEqual(to_gib(1073741824), 1)

    def test_a_started_gib_is_a_whole_gib(self):
        self.assertEqual(to_gib(1073741825), 2)
        self.assertEqual(to_gib(1), 1)


if __name__ == "__main__":
    unittest.main()
