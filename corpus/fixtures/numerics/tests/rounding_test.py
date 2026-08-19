import unittest
from decimal import Decimal

from numerics.errors import DomainError
from numerics.rounding import (
    MODES,
    distribute_decimal,
    round_decimal,
    round_half_even,
    round_half_up,
    round_to_step,
)


class RoundingModeTest(unittest.TestCase):
    def test_bankers_rounding(self):
        self.assertEqual(round_half_even(Decimal("0.5")), Decimal("0"))
        self.assertEqual(round_half_even(Decimal("1.5")), Decimal("2"))
        self.assertEqual(round_half_even(Decimal("2.5")), Decimal("2"))
        self.assertEqual(round_half_even(Decimal("-2.5")), Decimal("-2"))

    def test_commercial_rounding(self):
        self.assertEqual(round_half_up(Decimal("0.5")), Decimal("1"))
        self.assertEqual(round_half_up(Decimal("2.5")), Decimal("3"))
        self.assertEqual(round_half_up(Decimal("-2.5")), Decimal("-3"))

    def test_places(self):
        self.assertEqual(round_decimal(Decimal("1.2345"), 2), Decimal("1.23"))
        self.assertEqual(round_decimal(Decimal("1.2355"), 3), Decimal("1.236"))

    def test_directed_modes(self):
        self.assertEqual(round_decimal(Decimal("-1.5"), 0, "floor"), Decimal("-2"))
        self.assertEqual(round_decimal(Decimal("-1.5"), 0, "ceiling"), Decimal("-1"))
        self.assertEqual(round_decimal(Decimal("1.9"), 0, "down"), Decimal("1"))
        self.assertEqual(round_decimal(Decimal("1.1"), 0, "up"), Decimal("2"))

    def test_every_mode_is_usable(self):
        for mode in MODES:
            self.assertIsInstance(round_decimal(Decimal("1.25"), 1, mode), Decimal)

    def test_unknown_mode(self):
        with self.assertRaises(DomainError):
            round_decimal(Decimal("1"), 0, "stochastic")

    def test_negative_places(self):
        with self.assertRaises(DomainError):
            round_decimal(Decimal("1"), -1)


class StepRoundingTest(unittest.TestCase):
    def test_rounds_to_a_multiple(self):
        self.assertEqual(round_to_step(Decimal("7.3"), Decimal("0.25")), Decimal("7.25"))
        self.assertEqual(round_to_step(Decimal("7.4"), Decimal("0.25")), Decimal("7.50"))

    def test_step_must_be_positive(self):
        with self.assertRaises(DomainError):
            round_to_step(Decimal("1"), Decimal("0"))


class DistributeTest(unittest.TestCase):
    def test_split_preserves_the_total(self):
        parts = distribute_decimal(Decimal("100.00"), [1, 1, 1])
        self.assertEqual(sum(parts), Decimal("100.00"))
        self.assertEqual(parts, [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")])

    def test_weighted_split(self):
        parts = distribute_decimal(Decimal("10.00"), [3, 1])
        self.assertEqual(sum(parts), Decimal("10.00"))
        self.assertEqual(parts, [Decimal("7.50"), Decimal("2.50")])

    def test_negative_amount(self):
        parts = distribute_decimal(Decimal("-9.00"), [2, 1])
        self.assertEqual(sum(parts), Decimal("-9.00"))

    def test_precision_beyond_places_is_rejected(self):
        with self.assertRaises(DomainError):
            distribute_decimal(Decimal("1.005"), [1, 1], places=2)


if __name__ == "__main__":
    unittest.main()
