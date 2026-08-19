"""Hidden grader: minimum-penalty integer allocation."""

import itertools
import unittest
from decimal import Decimal
from fractions import Fraction

from numerics.allocate import allocation_cost, is_convex, min_penalty_allocation
from numerics.errors import AllocationError, DomainError

F = Fraction

# --- cases where allocating one unit at a time to the cheapest marginal bucket
# --- (the greedy exchange argument) provably loses, because a row is not convex.
GREEDY_TRAPS = [
    (2, [[0, 10, 1], [0, 4, 8]], F(1), [2, 0]),
    (4, [[0, 3, 3, 3, 0], [0, 1, 2, 3, 4]], F(0), [4, 0]),
    (5, [[0, 2, 4, 6, 8, 10], [0, 9, 9, 9, 1, 1], [0, 3, 6, 9, 12, 15]], F(1), [0, 5, 0]),
    (6, [[0, 1, 2, 3, 10, 11, 12], [0, 5, 5, 5, 5, 5, 5], [0, 4, 4, 4, 4, 4, 4]], F(4), [0, 0, 6]),
]

KNOWN = [
    (0, [[0, 1], [0, 1]], F(0), [0, 0]),
    (0, [], F(0), []),
    (2, [[0, 4, 5]], F(5), [2]),
    (2, [[0, 1, 3], [0, 2, 5]], F(3), [1, 1]),
    (3, [[0, 1], [0, 1], [0, 1]], F(3), [1, 1, 1]),
    (4, [[0, 3, 4, 9], [0, 1, 7, 8], [0, 2, 3, 4]], F(5), [0, 1, 3]),
    # Optimal cost is reachable two ways; the lexicographically smallest wins.
    (3, [[0, 5, 6], [0, 5, 6], [0, 1, 20]], F(7), [0, 2, 1]),
    (2, [[0, 1, 2], [0, 1, 2]], F(2), [0, 2]),
    (1, [[0, 5], [0, 5], [0, 5]], F(5), [0, 0, 1]),
    # Exact rationals: three thirds and one third plus two thirds both cost 1.
    (3, [[0, F(1, 3), F(2, 3)]] * 3, F(1), [0, 1, 2]),
    (2, [[0, F(1, 3)], [0, F(1, 3)], [0, F(1, 2)]], F(2, 3), [1, 1, 0]),
    # Decimal entries are exact too.
    (2, [[0, Decimal("0.1"), Decimal("0.3")], [0, Decimal("0.15"), Decimal("0.2")]],
     F(1, 5), [0, 2]),
]

# Deterministic families for the brute-force cross-check. No randomness.
DIGITS = [7, 3, 9, 1, 4, 8, 2, 6, 5, 0, 3, 7, 1, 9, 2, 8, 4, 6, 0, 5, 9, 1, 3, 7]


def build_table(buckets, capacity, offset):
    """A reproducible penalty table drawn from the fixed digit stream."""
    table = []
    for b in range(buckets):
        row = [F(0)]
        for k in range(capacity):
            step = DIGITS[(offset + b * capacity + k) % len(DIGITS)]
            row.append(row[-1] + F(step, 2))
        table.append(row)
    return table


def brute_force(units, costs):
    """Exhaustive minimum, tie-broken by the lexicographically smallest tuple."""
    best = None
    for combo in itertools.product(*[range(len(row)) for row in costs]):
        if sum(combo) != units:
            continue
        cost = sum((Fraction(costs[i][k]) for i, k in enumerate(combo)), Fraction(0))
        candidate = (cost, list(combo))
        if best is None or candidate[0] < best[0] or (
            candidate[0] == best[0] and candidate[1] < best[1]
        ):
            best = candidate
    return best


def greedy(units, costs):
    """The marginal-cost heuristic, valid only when every row is convex."""
    taken = [0] * len(costs)
    for _ in range(units):
        best = None
        for i, row in enumerate(costs):
            if taken[i] + 1 < len(row):
                margin = Fraction(row[taken[i] + 1]) - Fraction(row[taken[i]])
                if best is None or margin < best[0]:
                    best = (margin, i)
        if best is None:
            return None
        taken[best[1]] += 1
    return allocation_cost(costs, taken), taken


class KnownAnswerTest(unittest.TestCase):
    def test_table(self):
        for units, costs, cost, alloc in KNOWN:
            with self.subTest(units=units, costs=costs):
                got_cost, got_alloc = min_penalty_allocation(units, costs)
                self.assertEqual(got_cost, cost)
                self.assertEqual(got_alloc, alloc)

    def test_returned_cost_is_an_exact_rational(self):
        for units, costs, _, _ in KNOWN:
            with self.subTest(units=units):
                got_cost, _ = min_penalty_allocation(units, costs)
                self.assertIsInstance(got_cost, Fraction)

    def test_returned_allocation_is_plain_ints(self):
        _, alloc = min_penalty_allocation(4, [[0, 3, 4, 9], [0, 1, 7, 8], [0, 2, 3, 4]])
        self.assertTrue(all(type(x) is int for x in alloc))

    def test_cost_and_allocation_agree(self):
        for units, costs, _, _ in KNOWN:
            if not costs:
                continue
            with self.subTest(units=units):
                cost, alloc = min_penalty_allocation(units, costs)
                self.assertEqual(sum(alloc), units)
                self.assertEqual(cost, allocation_cost(costs, alloc))


class GreedyTrapTest(unittest.TestCase):
    def test_greedy_is_strictly_worse_on_these(self):
        for units, costs, cost, alloc in GREEDY_TRAPS:
            with self.subTest(units=units, costs=costs):
                self.assertFalse(all(is_convex(row) for row in costs))
                got_cost, got_alloc = min_penalty_allocation(units, costs)
                self.assertEqual(got_cost, cost)
                self.assertEqual(got_alloc, alloc)
                greedy_result = greedy(units, costs)
                self.assertIsNotNone(greedy_result)
                self.assertLess(got_cost, greedy_result[0])

    def test_greedy_ties_but_picks_the_wrong_representative(self):
        # Same optimal cost, but greedy's allocation is not the lexicographically
        # smallest optimum, so a greedy reconstruction still fails.
        units, costs = 3, [[0, 5, 6], [0, 5, 6], [0, 1, 20]]
        cost, alloc = min_penalty_allocation(units, costs)
        greedy_cost, greedy_alloc = greedy(units, costs)
        self.assertEqual(cost, greedy_cost)
        self.assertEqual(alloc, [0, 2, 1])
        self.assertNotEqual(alloc, greedy_alloc)


class BruteForceCrossCheckTest(unittest.TestCase):
    def test_small_tables(self):
        for buckets in (2, 3, 4):
            for capacity in (1, 2, 3):
                for offset in (0, 5, 11, 17):
                    costs = build_table(buckets, capacity, offset)
                    for units in range(0, buckets * capacity + 1):
                        with self.subTest(
                            buckets=buckets, capacity=capacity, offset=offset, units=units
                        ):
                            expected = brute_force(units, costs)
                            got_cost, got_alloc = min_penalty_allocation(units, costs)
                            self.assertEqual(got_cost, expected[0])
                            self.assertEqual(got_alloc, expected[1])

    def test_ragged_tables(self):
        tables = [
            [[0, 1, 5], [0, 2], [0, 9, 9, 9]],
            [[0, F(1, 2), F(1, 4)], [0, F(1, 3)], [0, F(1, 5), F(9, 10), F(1, 100)]],
            [[0, 4], [0, 4], [0, 4], [0, 1, 1, 1]],
            [[0, 0, 0, 7], [0, 6, 6], [0, 3]],
        ]
        for costs in tables:
            for units in range(0, sum(len(row) - 1 for row in costs) + 1):
                with self.subTest(costs=costs, units=units):
                    expected = brute_force(units, costs)
                    self.assertEqual(min_penalty_allocation(units, costs), (expected[0], expected[1]))


class LexicographicTest(unittest.TestCase):
    def test_all_optima_are_enumerated_and_the_smallest_is_chosen(self):
        tables = [
            [[0, 1, 2], [0, 1, 2], [0, 1, 2]],
            [[0, 2, 4], [0, 2, 4]],
            [[0, F(1, 3), F(2, 3)]] * 3,
            [[0, 5, 5], [0, 5, 5], [0, 5, 5]],
        ]
        for costs in tables:
            for units in range(0, sum(len(row) - 1 for row in costs) + 1):
                cost, alloc = min_penalty_allocation(units, costs)
                optima = [
                    list(combo)
                    for combo in itertools.product(*[range(len(row)) for row in costs])
                    if sum(combo) == units
                    and sum((Fraction(costs[i][k]) for i, k in enumerate(combo)), Fraction(0))
                    == cost
                ]
                with self.subTest(costs=costs, units=units):
                    self.assertEqual(alloc, min(optima))


class DomainTest(unittest.TestCase):
    def test_negative_units(self):
        with self.assertRaises(DomainError):
            min_penalty_allocation(-1, [[0, 1]])

    def test_non_integer_units(self):
        with self.assertRaises(DomainError):
            min_penalty_allocation(2.0, [[0, 1, 2]])

    def test_empty_row(self):
        with self.assertRaises(DomainError):
            min_penalty_allocation(1, [[0, 1], []])

    def test_capacity_shortfall(self):
        with self.assertRaises(AllocationError):
            min_penalty_allocation(5, [[0, 1], [0, 1]])
        with self.assertRaises(AllocationError):
            min_penalty_allocation(1, [])

    def test_zero_units_with_no_buckets(self):
        self.assertEqual(min_penalty_allocation(0, []), (Fraction(0), []))

    def test_exactly_at_capacity(self):
        cost, alloc = min_penalty_allocation(4, [[0, 1, 2], [0, 1, 2]])
        self.assertEqual(alloc, [2, 2])
        self.assertEqual(cost, Fraction(4))


if __name__ == "__main__":
    unittest.main()
