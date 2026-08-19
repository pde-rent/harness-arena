"""Hidden grader: exact largest-remainder apportionment."""

import unittest
from decimal import Decimal
from fractions import Fraction

from numerics.allocate import largest_remainder
from numerics.errors import AllocationError, DomainError
from numerics.rounding import distribute_decimal

KNOWN = [
    ([1, 1, 1, 1], 8, [2, 2, 2, 2]),
    ([1, 1, 1], 10, [4, 3, 3]),
    ([1, 1, 1], 1, [1, 0, 0]),
    ([1, 1, 1], 2, [1, 1, 0]),
    ([1, 2, 1], 4, [1, 2, 1]),
    ([1, 3], 3, [1, 2]),
    # Remainders tie at 1/2; the larger quota takes the unit.
    ([1, 3], 2, [0, 2]),
    ([3, 1], 2, [2, 0]),
    # Remainders and quotas both tie; the lower index takes the unit.
    ([1, 1, 1, 1], 6, [2, 2, 1, 1]),
    ([1, 1], 1, [1, 0]),
    ([5, 5, 5, 5, 5, 5], 9, [2, 2, 2, 1, 1, 1]),
    # A zero-weight bucket is entitled to nothing.
    ([0, 1, 1], 4, [0, 2, 2]),
    ([0, 0, 1], 3, [0, 0, 3]),
    # Nothing to hand out.
    ([2, 3], 0, [0, 0]),
    ([], 0, []),
    # The classic 3-seat / 7-state shape.
    ([100, 100, 100, 100, 100, 100, 100], 3, [1, 1, 1, 0, 0, 0, 0]),
    # Exact rationals must not be rounded on the way in.
    ([Fraction(1, 3), Fraction(1, 3), Fraction(1, 3)], 10, [4, 3, 3]),
    ([Fraction(1, 6), Fraction(1, 3), Fraction(1, 2)], 6, [1, 2, 3]),
    ([Decimal("0.1"), Decimal("0.2"), Decimal("0.7")], 10, [1, 2, 7]),
    ([Decimal("1.5"), Decimal("1.5"), Decimal("1.0")], 8, [3, 3, 2]),
    # Floats denote exactly the binary value they hold.
    ([0.1, 0.2], 3, [1, 2]),
    ([0.25, 0.25, 0.5], 4, [1, 1, 2]),
]

WEIGHT_VECTORS = [
    [3, 5, 7, 11],
    [1, 1, 1],
    [1, 2, 3, 4, 5],
    [0, 1, 0, 1],
    [Fraction(1, 7), Fraction(2, 7), Fraction(4, 7)],
    [10, 10, 10, 10, 10, 10, 10],
    [1, 1000000],
    [Decimal("0.33"), Decimal("0.33"), Decimal("0.34")],
]


def reference(weights, total):
    """Independent exact reimplementation of the stated rule."""
    exact = [Fraction(w) if not isinstance(w, Fraction) else w for w in weights]
    mass = sum(exact, Fraction(0))
    quotas = [w * total / mass for w in exact]
    base = [q.numerator // q.denominator for q in quotas]
    left = total - sum(base)
    order = sorted(range(len(exact)), key=lambda i: (-(quotas[i] - base[i]), -quotas[i], i))
    for i in order[:left]:
        base[i] += 1
    return base


class KnownAnswerTest(unittest.TestCase):
    def test_table(self):
        for weights, total, expected in KNOWN:
            with self.subTest(weights=weights, total=total):
                self.assertEqual(largest_remainder(weights, total), expected)

    def test_results_are_plain_ints(self):
        got = largest_remainder([1, 2, 3], 7)
        self.assertTrue(all(type(x) is int for x in got))


class InvariantTest(unittest.TestCase):
    def test_total_is_preserved_for_every_total(self):
        for weights in WEIGHT_VECTORS:
            for total in range(0, 41):
                with self.subTest(weights=weights, total=total):
                    shares = largest_remainder(weights, total)
                    self.assertEqual(len(shares), len(weights))
                    self.assertEqual(sum(shares), total)
                    self.assertTrue(all(s >= 0 for s in shares))

    def test_every_share_is_within_one_of_its_quota(self):
        for weights in WEIGHT_VECTORS:
            mass = sum(Fraction(w) for w in weights)
            if mass == 0:
                continue
            for total in (1, 7, 13, 40):
                shares = largest_remainder(weights, total)
                for share, weight in zip(shares, weights):
                    quota = Fraction(weight) * total / mass
                    with self.subTest(weights=weights, total=total, weight=weight):
                        self.assertLess(abs(Fraction(share) - quota), 1)

    def test_matches_the_independent_reference(self):
        for weights in WEIGHT_VECTORS:
            if sum(Fraction(w) for w in weights) == 0:
                continue
            for total in range(0, 41):
                with self.subTest(weights=weights, total=total):
                    self.assertEqual(largest_remainder(weights, total), reference(weights, total))

    def test_a_zero_weight_never_receives_anything(self):
        for total in range(0, 30):
            shares = largest_remainder([0, 4, 0, 6], total)
            with self.subTest(total=total):
                self.assertEqual(shares[0], 0)
                self.assertEqual(shares[2], 0)

    def test_order_determinism(self):
        weights = [1, 1, 1, 1, 1]
        for total in range(0, 20):
            with self.subTest(total=total):
                self.assertEqual(
                    largest_remainder(weights, total), largest_remainder(weights, total)
                )


class DomainTest(unittest.TestCase):
    def test_negative_total(self):
        with self.assertRaises(DomainError):
            largest_remainder([1, 1], -1)

    def test_non_integer_total(self):
        with self.assertRaises(DomainError):
            largest_remainder([1, 1], 2.0)

    def test_negative_weight(self):
        with self.assertRaises(DomainError):
            largest_remainder([1, -1], 4)
        with self.assertRaises(DomainError):
            largest_remainder([Fraction(-1, 2), 1], 4)

    def test_no_buckets_but_units_to_place(self):
        with self.assertRaises(AllocationError):
            largest_remainder([], 3)

    def test_zero_total_weight(self):
        with self.assertRaises(AllocationError):
            largest_remainder([0, 0], 5)
        self.assertEqual(largest_remainder([0, 0], 0), [0, 0])


class DecimalSplitTest(unittest.TestCase):
    """`distribute_decimal` is layered on the apportionment and must stay exact."""

    def test_splits_add_up(self):
        cases = [
            (Decimal("100.00"), [1, 1, 1], 2),
            (Decimal("10.00"), [3, 1], 2),
            (Decimal("0.07"), [1, 1, 1, 1], 2),
            (Decimal("-9.00"), [2, 1], 2),
            (Decimal("1234.5"), [1, 2, 3, 4], 1),
            (Decimal("1"), [1, 1, 1], 0),
        ]
        for amount, weights, places in cases:
            with self.subTest(amount=amount, weights=weights):
                parts = distribute_decimal(amount, weights, places=places)
                self.assertEqual(sum(parts), amount)
                self.assertEqual(len(parts), len(weights))

    def test_thirds_of_a_hundred(self):
        self.assertEqual(
            distribute_decimal(Decimal("100.00"), [1, 1, 1]),
            [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")],
        )

    def test_penny_split(self):
        self.assertEqual(
            distribute_decimal(Decimal("0.03"), [1, 1, 1, 1]),
            [Decimal("0.01"), Decimal("0.01"), Decimal("0.01"), Decimal("0.00")],
        )


if __name__ == "__main__":
    unittest.main()
