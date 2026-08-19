import unittest
from decimal import Decimal

from capacity.pricing import billable_gib, monthly_cost, shard_cost, storage_cost, within_budget
from tests.helpers import make_config


class AllowanceTest(unittest.TestCase):
    def setUp(self):
        self.cfg = make_config(
            hot_tier_free_gib=1000,
            price_tiers=((10000, "0.021"), (40000, "0.017"), (None, "0.012")),
            shard_monthly_usd="45.00",
            monthly_budget_usd="700.00",
        )

    def test_allowance_is_deducted_before_any_tier(self):
        self.assertEqual(billable_gib(self.cfg, 1000), 0)
        self.assertEqual(billable_gib(self.cfg, 1500), 500)
        self.assertEqual(storage_cost(self.cfg, 1000), Decimal("0"))

    def test_inside_the_allowance_storage_is_free(self):
        self.assertEqual(storage_cost(self.cfg, 999), Decimal("0"))

    def test_tier_sizes_measure_billable_gib(self):
        # 11000 stored - 1000 free = 10000 billable, exactly filling the first tier.
        self.assertEqual(storage_cost(self.cfg, 11000), Decimal("210.000"))
        # one more GiB spills into the second tier
        self.assertEqual(storage_cost(self.cfg, 11001), Decimal("210.017"))

    def test_all_three_tiers(self):
        # 61000 - 1000 = 60000 billable = 10000 + 40000 + 10000
        self.assertEqual(storage_cost(self.cfg, 61000), Decimal("1010.000"))


class InvoiceTest(unittest.TestCase):
    def setUp(self):
        self.cfg = make_config(
            hot_tier_free_gib=1000,
            price_tiers=((10000, "0.021"), (40000, "0.017"), (None, "0.012")),
            shard_monthly_usd="45.00",
            monthly_budget_usd="700.00",
        )

    def test_shards_are_billed_whole(self):
        self.assertEqual(shard_cost(self.cfg, 7), Decimal("315.00"))

    def test_total_is_rounded_to_cents_half_up(self):
        self.assertEqual(monthly_cost(self.cfg, 11001, 0), Decimal("210.02"))

    def test_budget_comparison_is_inclusive(self):
        cheap = make_config(
            hot_tier_free_gib=1000,
            price_tiers=((10000, "0.021"), (40000, "0.017"), (None, "0.012")),
            shard_monthly_usd="100.00",
            monthly_budget_usd="200.00",
        )
        self.assertEqual(monthly_cost(cheap, 500, 2), Decimal("200.00"))
        self.assertTrue(within_budget(cheap, 500, 2))
        self.assertFalse(within_budget(cheap, 1500, 2))


if __name__ == "__main__":
    unittest.main()
