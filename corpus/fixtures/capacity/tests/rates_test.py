import unittest

from capacity.rates import (
    SECONDS_PER_HOUR,
    average_payload_bytes,
    billable,
    daily_events,
    load_samples,
    peak_events_per_second,
    peak_hour,
)
from tests.helpers import samples


class FleetFilterTest(unittest.TestCase):
    def test_only_the_named_fleet_survives(self):
        rows = samples([10, 20]) + samples([9000], fleet="loadtest")
        kept = billable(rows, "prod")
        self.assertEqual([s.events for s in kept], [10, 20])

    def test_missing_fleet_raises(self):
        with self.assertRaises(ValueError):
            billable(samples([1]), "nope")

    def test_data_file_carries_more_than_one_fleet(self):
        rows = load_samples()
        self.assertGreater(len({s.fleet for s in rows}), 1)


class RateTest(unittest.TestCase):
    def test_hourly_counts_are_divided_by_3600(self):
        self.assertEqual(SECONDS_PER_HOUR, 3600)
        rows = samples([3600, 7200])
        self.assertEqual(peak_hour(rows).events, 7200)
        self.assertEqual(peak_events_per_second(rows), 2)

    def test_partial_event_per_second_rounds_up(self):
        self.assertEqual(peak_events_per_second(samples([3601])), 2)

    def test_daily_events_sums_every_hour(self):
        self.assertEqual(daily_events(samples([1, 2, 3])), 6)


class PayloadTest(unittest.TestCase):
    def test_average_is_weighted_by_event_count(self):
        rows = samples([100], payload_per_event=1000) + samples([300], payload_per_event=2000)
        rows[1] = rows[1].__class__(1, "prod", 300, 300 * 2000)
        self.assertEqual(average_payload_bytes(rows), 1750)

    def test_fractional_average_rounds_up(self):
        rows = [type(samples([1])[0])(0, "prod", 4, 4001)]
        self.assertEqual(average_payload_bytes(rows), 1001)


if __name__ == "__main__":
    unittest.main()
