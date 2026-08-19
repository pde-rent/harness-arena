"""Hidden grader: compensated summation."""

import itertools
import math
import unittest
from fractions import Fraction

from numerics.summation import (
    SumState,
    compensated_cumsum,
    compensated_sum,
    merge_sum_states,
    sum_state,
    total_of,
)

# Deterministic, hard-coded adversarial samples. No randomness at verify time.
DATASETS = {
    "swamp": [1e100, 1.0, -1e100, 1.0],
    "big_head": [1e16] + [1.0] * 8 + [-1e16],
    "mixed_signs": [1e17, -1e17, 1.0, 3.0, -2.0],
    "tenths": [0.1] * 10,
    "long_tail": [1e12] + [1e-4] * 1000,
    "wide_dynamic_range": [1e30, 1.0, -1e30, 1e-30, 2.0],
    "reciprocal_squares": [1.0 / (i * i) for i in range(1, 500)],
    "cancelling_pair": [3.0, 1e18, -1e18, -3.0, 7.5],
    "descending": [float(10 ** -k) for k in range(0, 20)],
}

KNOWN_ANSWERS = [
    ([], 0.0),
    ([2.5], 2.5),
    ([1.0, 2.0, 3.0], 6.0),
    ([1e100, 1.0, -1e100, 1.0], 2.0),
    ([1.0, 1e100, 1.0, -1e100], 2.0),
    ([1e16] + [1.0] * 8 + [-1e16], 8.0),
    ([1e17, -1e17, 1.0, 3.0, -2.0], 2.0),
    ([3.0, 1e18, -1e18, -3.0, 7.5], 7.5),
    ([1e30, 1.0, -1e30, 1e-30, 2.0], 3.0),
    ([-0.0, 0.0], 0.0),
]


def exact_total(values):
    """The correctly rounded exact sum, computed with rational arithmetic."""
    return float(sum((Fraction(v) for v in values), Fraction(0)))


class KnownAnswerTest(unittest.TestCase):
    def test_table(self):
        for values, expected in KNOWN_ANSWERS:
            with self.subTest(values=values[:4]):
                self.assertEqual(compensated_sum(list(values)), expected)

    def test_matches_exact_rational_sum_bit_for_bit(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                self.assertEqual(compensated_sum(values), exact_total(values))

    def test_accepts_any_iterable(self):
        self.assertEqual(compensated_sum(iter([1e100, 1.0, -1e100, 1.0])), 2.0)
        self.assertEqual(compensated_sum(x for x in (1.0, 2.0)), 3.0)


class SpecialValueTest(unittest.TestCase):
    def test_nan_dominates(self):
        for values in ([math.nan], [1.0, math.nan], [math.inf, math.nan],
                       [math.nan, -math.inf], [1e100, math.nan, -1e100]):
            with self.subTest(values=values):
                self.assertTrue(math.isnan(compensated_sum(values)))

    def test_single_signed_infinity(self):
        self.assertEqual(compensated_sum([1.0, math.inf, 2.0]), math.inf)
        self.assertEqual(compensated_sum([math.inf, math.inf]), math.inf)
        self.assertEqual(compensated_sum([-math.inf, 5.0]), -math.inf)
        self.assertEqual(compensated_sum([1e100, -math.inf, -1e100]), -math.inf)

    def test_opposing_infinities(self):
        for values in ([math.inf, -math.inf], [-math.inf, 1.0, math.inf],
                       [1e300, math.inf, 2.0, -math.inf]):
            with self.subTest(values=values):
                self.assertTrue(math.isnan(compensated_sum(values)))

    def test_infinity_does_not_poison_the_finite_part(self):
        # The finite tail must still be summed correctly once the infinity is
        # removed from a merged state.
        finite = sum_state([1e100, 1.0, -1e100, 1.0])
        self.assertEqual(total_of(finite), 2.0)


class PermutationInvarianceTest(unittest.TestCase):
    """A compensated sum of these samples must not depend on the input order."""

    CASES = [
        [1e100, 1.0, -1e100, 1.0],
        [1.0, 1e16, -1e16, 1.0, 1e-16],
        [1e17, -1e17, 1.0, 3.0, -2.0],
        [1e30, 1.0, -1e30, 2.0],
        [7.5, 1e18, -1e18, 3.0, -3.0],
    ]

    def test_fixed_permutations(self):
        for case in self.CASES:
            expected = exact_total(case)
            for perm in itertools.permutations(case):
                with self.subTest(case=case[:2], perm=perm[:2]):
                    self.assertEqual(compensated_sum(list(perm)), expected)


class CumulativeSumTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(compensated_cumsum([]), [])

    def test_every_prefix_is_exact(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                got = compensated_cumsum(values)
                self.assertEqual(len(got), len(values))
                expected = [exact_total(values[: k + 1]) for k in range(len(values))]
                self.assertEqual(got, expected)

    def test_special_values_propagate_from_the_point_they_appear(self):
        got = compensated_cumsum([1.0, math.inf, 2.0])
        self.assertEqual(got[0], 1.0)
        self.assertEqual(got[1], math.inf)
        self.assertEqual(got[2], math.inf)

        got = compensated_cumsum([1.0, math.inf, -math.inf])
        self.assertEqual(got[1], math.inf)
        self.assertTrue(math.isnan(got[2]))


class StateTest(unittest.TestCase):
    def test_default_state(self):
        self.assertEqual(total_of(SumState()), 0.0)
        self.assertEqual(SumState().count, 0)

    def test_count_is_tracked(self):
        self.assertEqual(sum_state(DATASETS["long_tail"]).count, 1001)
        self.assertEqual(sum_state([math.nan, math.inf, 1.0]).count, 3)

    def test_merge_reproduces_the_single_pass_total(self):
        for name, values in DATASETS.items():
            for cut in (0, 1, len(values) // 3, len(values) // 2, len(values)):
                with self.subTest(dataset=name, cut=cut):
                    merged = merge_sum_states(
                        sum_state(values[:cut]), sum_state(values[cut:])
                    )
                    self.assertEqual(merged.count, len(values))
                    self.assertEqual(total_of(merged), exact_total(values))

    def test_merge_is_associative_over_a_three_way_split(self):
        values = DATASETS["wide_dynamic_range"] + DATASETS["mixed_signs"]
        a, b, c = values[:3], values[3:6], values[6:]
        left = merge_sum_states(merge_sum_states(sum_state(a), sum_state(b)), sum_state(c))
        right = merge_sum_states(sum_state(a), merge_sum_states(sum_state(b), sum_state(c)))
        self.assertEqual(total_of(left), total_of(right))
        self.assertEqual(total_of(left), exact_total(values))

    def test_merge_propagates_special_values(self):
        self.assertTrue(
            math.isnan(total_of(merge_sum_states(sum_state([math.inf]), sum_state([-math.inf]))))
        )
        self.assertEqual(
            total_of(merge_sum_states(sum_state([1.0]), sum_state([math.inf]))), math.inf
        )
        self.assertTrue(
            math.isnan(total_of(merge_sum_states(sum_state([math.nan]), sum_state([1.0]))))
        )


if __name__ == "__main__":
    unittest.main()
