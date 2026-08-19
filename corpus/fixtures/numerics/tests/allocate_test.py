import unittest
from decimal import Decimal
from fractions import Fraction

from numerics.allocate import (
    allocation_cost,
    is_convex,
    largest_remainder,
    min_penalty_allocation,
    to_exact,
)
from numerics.errors import AllocationError, DomainError


class ToExactTest(unittest.TestCase):
    def test_conversions(self):
        self.assertEqual(to_exact(3), Fraction(3))
        self.assertEqual(to_exact(Fraction(1, 3)), Fraction(1, 3))
        self.assertEqual(to_exact(Decimal("0.1")), Fraction(1, 10))
        self.assertEqual(to_exact(0.5), Fraction(1, 2))


class ConvexityTest(unittest.TestCase):
    def test_short_rows_are_convex(self):
        self.assertTrue(is_convex([]))
        self.assertTrue(is_convex([1]))
        self.assertTrue(is_convex([1, 2]))

    def test_increasing_differences(self):
        self.assertTrue(is_convex([0, 1, 3, 6, 10]))
        self.assertTrue(is_convex([0, 0, 0, 0]))

    def test_decreasing_differences(self):
        self.assertFalse(is_convex([0, 10, 1]))
        self.assertFalse(is_convex([0, 5, 9, 12]))


class LargestRemainderTest(unittest.TestCase):
    def test_exact_split(self):
        self.assertEqual(largest_remainder([1, 1, 1, 1], 8), [2, 2, 2, 2])

    def test_thirds(self):
        self.assertEqual(largest_remainder([1, 1, 1], 10), [4, 3, 3])

    def test_total_is_always_preserved(self):
        for total in range(0, 25):
            shares = largest_remainder([3, 5, 7, 11], total)
            self.assertEqual(sum(shares), total)

    def test_zero_total(self):
        self.assertEqual(largest_remainder([2, 3], 0), [0, 0])

    def test_zero_weight_bucket_gets_nothing_first(self):
        self.assertEqual(largest_remainder([0, 1, 1], 4), [0, 2, 2])

    def test_no_buckets(self):
        self.assertEqual(largest_remainder([], 0), [])
        with self.assertRaises(AllocationError):
            largest_remainder([], 3)

    def test_zero_mass(self):
        with self.assertRaises(AllocationError):
            largest_remainder([0, 0], 5)

    def test_negative_weight(self):
        with self.assertRaises(DomainError):
            largest_remainder([1, -1], 4)

    def test_negative_total(self):
        with self.assertRaises(DomainError):
            largest_remainder([1, 1], -1)


class MinPenaltyTest(unittest.TestCase):
    def test_zero_units(self):
        cost, alloc = min_penalty_allocation(0, [[0, 1], [0, 1]])
        self.assertEqual(cost, Fraction(0))
        self.assertEqual(alloc, [0, 0])

    def test_single_bucket(self):
        cost, alloc = min_penalty_allocation(2, [[0, 4, 5]])
        self.assertEqual(cost, Fraction(5))
        self.assertEqual(alloc, [2])

    def test_convex_case(self):
        cost, alloc = min_penalty_allocation(2, [[0, 1, 3], [0, 2, 5]])
        self.assertEqual(cost, Fraction(3))
        self.assertEqual(alloc, [1, 1])

    def test_cost_matches_allocation_cost(self):
        costs = [[0, 3, 4, 9], [0, 1, 7, 8], [0, 2, 3, 4]]
        cost, alloc = min_penalty_allocation(4, costs)
        self.assertEqual(cost, allocation_cost(costs, alloc))
        self.assertEqual(sum(alloc), 4)

    def test_capacity_is_respected(self):
        cost, alloc = min_penalty_allocation(3, [[0, 1], [0, 1], [0, 1]])
        self.assertEqual(alloc, [1, 1, 1])
        self.assertEqual(cost, Fraction(3))

    def test_over_capacity(self):
        with self.assertRaises(AllocationError):
            min_penalty_allocation(5, [[0, 1], [0, 1]])

    def test_negative_units(self):
        with self.assertRaises(DomainError):
            min_penalty_allocation(-1, [[0, 1]])

    def test_empty_row(self):
        with self.assertRaises(DomainError):
            min_penalty_allocation(1, [[0, 1], []])


class AllocationCostTest(unittest.TestCase):
    def test_sums_the_selected_entries(self):
        self.assertEqual(allocation_cost([[0, 5], [0, 7, 9]], [1, 2]), Fraction(14))

    def test_length_mismatch(self):
        with self.assertRaises(DomainError):
            allocation_cost([[0, 1]], [0, 0])

    def test_out_of_capacity(self):
        with self.assertRaises(DomainError):
            allocation_cost([[0, 1]], [2])


if __name__ == "__main__":
    unittest.main()
