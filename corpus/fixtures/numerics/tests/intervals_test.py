import unittest
from fractions import Fraction

from numerics.errors import DomainError
from numerics.intervals import (
    Interval,
    covers,
    intersect_intervals,
    interval,
    merge_intervals,
    subtract_intervals,
    total_coverage,
)


class IntervalTest(unittest.TestCase):
    def test_length_and_emptiness(self):
        self.assertEqual(interval(1, 4).length, Fraction(3))
        self.assertTrue(interval(2, 2).empty)

    def test_reversed_endpoints_are_rejected(self):
        with self.assertRaises(DomainError):
            interval(5, 1)

    def test_decimal_and_float_endpoints(self):
        self.assertEqual(interval(0.5, 1.5).length, Fraction(1))


class MergeTest(unittest.TestCase):
    def test_disjoint_intervals_are_kept(self):
        items = [interval(0, 1), interval(2, 3)]
        self.assertEqual(merge_intervals(items), items)

    def test_overlapping_intervals_coalesce(self):
        merged = merge_intervals([interval(0, 2), interval(1, 3)])
        self.assertEqual(merged, [interval(0, 3)])

    def test_touching_intervals_coalesce(self):
        merged = merge_intervals([interval(0, 1), interval(1, 2)])
        self.assertEqual(merged, [interval(0, 2)])

    def test_nested_intervals_coalesce(self):
        merged = merge_intervals([interval(0, 10), interval(2, 3)])
        self.assertEqual(merged, [interval(0, 10)])

    def test_empty_intervals_are_dropped(self):
        self.assertEqual(merge_intervals([interval(1, 1)]), [])

    def test_input_order_does_not_matter(self):
        a = merge_intervals([interval(4, 6), interval(0, 1), interval(5, 9)])
        b = merge_intervals([interval(5, 9), interval(4, 6), interval(0, 1)])
        self.assertEqual(a, b)


class CoverageTest(unittest.TestCase):
    def test_union_measure(self):
        self.assertEqual(total_coverage([interval(0, 2), interval(1, 5)]), Fraction(5))

    def test_exact_rational_coverage(self):
        items = [interval(Fraction(1, 3), Fraction(2, 3)), interval(Fraction(2, 3), 1)]
        self.assertEqual(total_coverage(items), Fraction(2, 3))

    def test_empty_set(self):
        self.assertEqual(total_coverage([]), Fraction(0))


class SetOpsTest(unittest.TestCase):
    def test_intersection(self):
        left = [interval(0, 5), interval(7, 9)]
        right = [interval(3, 8)]
        self.assertEqual(intersect_intervals(left, right), [interval(3, 5), interval(7, 8)])

    def test_intersection_is_symmetric(self):
        left = [interval(0, 5)]
        right = [interval(2, 9)]
        self.assertEqual(intersect_intervals(left, right), intersect_intervals(right, left))

    def test_subtraction_punches_holes(self):
        self.assertEqual(
            subtract_intervals([interval(0, 10)], [interval(2, 4), interval(6, 7)]),
            [interval(0, 2), interval(4, 6), interval(7, 10)],
        )

    def test_subtracting_everything_leaves_nothing(self):
        self.assertEqual(subtract_intervals([interval(0, 3)], [interval(0, 3)]), [])

    def test_covers_is_half_open(self):
        items = [interval(0, 2)]
        self.assertTrue(covers(items, 0))
        self.assertTrue(covers(items, Fraction(3, 2)))
        self.assertFalse(covers(items, 2))


if __name__ == "__main__":
    unittest.main()
