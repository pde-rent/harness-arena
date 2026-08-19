import math
import unittest

from numerics.summation import (
    SumState,
    compensated_cumsum,
    compensated_sum,
    merge_sum_states,
    sum_state,
    total_of,
)


class CompensatedSumTest(unittest.TestCase):
    def test_empty_sum_is_zero(self):
        self.assertEqual(compensated_sum([]), 0.0)

    def test_small_exact_sums(self):
        self.assertEqual(compensated_sum([1.0, 2.0, 3.0]), 6.0)
        self.assertEqual(compensated_sum([0.5, 0.25, 0.125]), 0.875)
        self.assertEqual(compensated_sum([-4.0, 4.0]), 0.0)

    def test_single_value_round_trips(self):
        self.assertEqual(compensated_sum([2.5]), 2.5)

    def test_catastrophic_cancellation_is_recovered(self):
        self.assertEqual(compensated_sum([1e100, 1.0, -1e100, 1.0]), 2.0)

    def test_naive_summation_would_lose_the_tail(self):
        values = [1e16] + [1.0] * 8 + [-1e16]
        self.assertEqual(compensated_sum(values), 8.0)

    def test_nan_input_yields_nan(self):
        self.assertTrue(math.isnan(compensated_sum([1.0, math.nan, 2.0])))

    def test_single_signed_infinity_survives(self):
        self.assertEqual(compensated_sum([1.0, math.inf, 2.0]), math.inf)
        self.assertEqual(compensated_sum([1.0, -math.inf]), -math.inf)

    def test_opposing_infinities_yield_nan(self):
        self.assertTrue(math.isnan(compensated_sum([math.inf, -math.inf])))
        self.assertTrue(math.isnan(compensated_sum([1.0, -math.inf, math.inf, 2.0])))


class CumulativeSumTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(compensated_cumsum([]), [])

    def test_prefix_agreement(self):
        values = [3.0, -1.0, 0.5, 10.0]
        expected = [compensated_sum(values[: k + 1]) for k in range(len(values))]
        self.assertEqual(compensated_cumsum(values), expected)

    def test_last_element_matches_total(self):
        values = [1e100, 1.0, -1e100, 1.0]
        self.assertEqual(compensated_cumsum(values)[-1], 2.0)


class SumStateTest(unittest.TestCase):
    def test_default_state_totals_zero(self):
        self.assertEqual(total_of(SumState()), 0.0)

    def test_state_records_count(self):
        self.assertEqual(sum_state([1.0, 2.0, 3.0]).count, 3)

    def test_merge_matches_single_pass(self):
        left = [1e100, 1.0]
        right = [-1e100, 1.0]
        merged = merge_sum_states(sum_state(left), sum_state(right))
        self.assertEqual(total_of(merged), 2.0)
        self.assertEqual(merged.count, 4)

    def test_merge_propagates_special_values(self):
        merged = merge_sum_states(sum_state([math.inf]), sum_state([1.0]))
        self.assertEqual(total_of(merged), math.inf)


if __name__ == "__main__":
    unittest.main()
