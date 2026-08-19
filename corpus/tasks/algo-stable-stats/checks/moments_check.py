"""Hidden grader: streaming moments and their parallel merge."""

import math
import unittest
from fractions import Fraction

from numerics.errors import DomainError, EmptyInputError
from numerics.moments import (
    MomentState,
    mean,
    merge_many_moments,
    merge_moments,
    moments_of,
    push_moment,
    skewness,
    stdev,
    variance,
)

# Deterministic, hard-coded samples. Every one of them is badly conditioned for
# the sum-of-squares formula: the mean is orders of magnitude larger than the
# spread, so ``E[x^2] - E[x]^2`` cancels away the whole answer.
DATASETS = {
    "offset_spread": [1e9 + (i * 37 % 1000) for i in range(60)],
    "offset_fine": [1e9 + i * 0.25 for i in range(40)],
    "offset_mixed": [1e8 + (i % 7) * 3 + i * 0.5 for i in range(80)],
    "negative_offset": [-1e9 + i * 1.5 for i in range(50)],
    "textbook": [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0],
    "skewed": [1.0, 1.0, 1.0, 1.0, 10.0],
    "two_scales": [1e6, 1e6 + 1.0, 1e6 + 2.0, 1e6 + 3.0, 1e6 + 100.0],
}

VARIANCE_RTOL = 1e-9
SKEW_RTOL = 1e-6


def exact_moments(values):
    """Exact (n, mean, m2, m3) of the given floats, in rational arithmetic."""
    xs = [Fraction(v) for v in values]
    n = len(xs)
    m = sum(xs, Fraction(0)) / n
    m2 = sum(((x - m) ** 2 for x in xs), Fraction(0))
    m3 = sum(((x - m) ** 3 for x in xs), Fraction(0))
    return n, m, m2, m3


def assert_close(case, got, expected, rtol):
    if expected == 0:
        case.assertEqual(got, 0.0)
        return
    case.assertLessEqual(abs(got - expected) / abs(expected), rtol,
                         f"got {got!r}, expected {expected!r}")


class ExactReferenceTest(unittest.TestCase):
    def test_variance_agrees_with_the_rational_reference(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                n, m, m2, _ = exact_moments(values)
                state = moments_of(values)
                self.assertEqual(state.n, n)
                assert_close(self, mean(state), float(m), 1e-12)
                assert_close(self, variance(state), float(m2 / n), VARIANCE_RTOL)
                assert_close(self, variance(state, ddof=1), float(m2 / (n - 1)), VARIANCE_RTOL)
                assert_close(self, stdev(state), math.sqrt(float(m2 / n)), VARIANCE_RTOL)

    def test_state_m2_and_m3_agree_with_the_rational_reference(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                _, _, m2, m3 = exact_moments(values)
                state = moments_of(values)
                assert_close(self, state.m2, float(m2), VARIANCE_RTOL)
                assert_close(self, state.m3, float(m3), SKEW_RTOL)

    def test_skewness_agrees_with_the_rational_reference(self):
        for name, values in DATASETS.items():
            if name in ("textbook", "skewed", "two_scales", "offset_spread", "offset_mixed"):
                with self.subTest(dataset=name):
                    n, _, m2, m3 = exact_moments(values)
                    expected = math.sqrt(n) * float(m3) / float(m2) ** 1.5
                    assert_close(self, skewness(moments_of(values)), expected, SKEW_RTOL)

    def test_variance_is_never_negative(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                self.assertGreaterEqual(variance(moments_of(values)), 0.0)
        self.assertEqual(variance(moments_of([1e9] * 25)), 0.0)


class IncrementalTest(unittest.TestCase):
    def test_push_matches_bulk(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                state = MomentState()
                for value in values:
                    state = push_moment(state, value)
                self.assertEqual(state, moments_of(values))

    def test_push_is_pure(self):
        before = moments_of([1.0, 2.0, 3.0])
        snapshot = MomentState(before.n, before.mean, before.m2, before.m3)
        push_moment(before, 99.0)
        self.assertEqual(before, snapshot)

    def test_first_observation(self):
        state = push_moment(MomentState(), 5.0)
        self.assertEqual(state.n, 1)
        self.assertEqual(state.mean, 5.0)
        self.assertEqual(state.m2, 0.0)
        self.assertEqual(state.m3, 0.0)


class MergeTest(unittest.TestCase):
    def test_merge_with_empty_is_the_identity(self):
        state = moments_of(DATASETS["textbook"])
        self.assertEqual(merge_moments(state, MomentState()), state)
        self.assertEqual(merge_moments(MomentState(), state), state)
        self.assertEqual(merge_moments(MomentState(), MomentState()), MomentState())

    def test_merge_matches_the_single_pass_state_at_every_cut(self):
        for name, values in DATASETS.items():
            whole = moments_of(values)
            _, _, m2, _ = exact_moments(values)
            for cut in range(0, len(values) + 1, max(1, len(values) // 7)):
                with self.subTest(dataset=name, cut=cut):
                    merged = merge_moments(moments_of(values[:cut]), moments_of(values[cut:]))
                    self.assertEqual(merged.n, whole.n)
                    assert_close(self, merged.mean, whole.mean, 1e-12)
                    assert_close(self, merged.m2, float(m2), VARIANCE_RTOL)

    def test_merge_is_associative(self):
        for name, values in DATASETS.items():
            if len(values) < 9:
                continue
            with self.subTest(dataset=name):
                third = len(values) // 3
                a = moments_of(values[:third])
                b = moments_of(values[third : 2 * third])
                c = moments_of(values[2 * third :])
                left = merge_moments(merge_moments(a, b), c)
                right = merge_moments(a, merge_moments(b, c))
                self.assertEqual(left.n, right.n)
                assert_close(self, left.mean, right.mean, 1e-12)
                assert_close(self, left.m2, right.m2, VARIANCE_RTOL)
                assert_close(self, left.m3, right.m3, SKEW_RTOL)

    def test_merge_many_matches_pairwise_folding(self):
        values = DATASETS["offset_spread"]
        chunks = [moments_of(values[i : i + 7]) for i in range(0, len(values), 7)]
        folded = merge_many_moments(chunks)
        _, _, m2, _ = exact_moments(values)
        self.assertEqual(folded.n, len(values))
        assert_close(self, folded.m2, float(m2), VARIANCE_RTOL)

    def test_merged_m3_agrees_with_the_rational_reference(self):
        for name in ("offset_spread", "offset_mixed", "textbook"):
            values = DATASETS[name]
            with self.subTest(dataset=name):
                _, _, _, m3 = exact_moments(values)
                half = len(values) // 2
                merged = merge_moments(moments_of(values[:half]), moments_of(values[half:]))
                assert_close(self, merged.m3, float(m3), SKEW_RTOL)


class DomainTest(unittest.TestCase):
    def test_empty_sample(self):
        empty = moments_of([])
        self.assertEqual(empty, MomentState())
        with self.assertRaises(EmptyInputError):
            mean(empty)
        with self.assertRaises(EmptyInputError):
            variance(empty)
        with self.assertRaises(EmptyInputError):
            stdev(empty)

    def test_ddof_must_leave_positive_freedom(self):
        state = moments_of([1.0, 2.0, 3.0])
        with self.assertRaises(DomainError):
            variance(state, ddof=3)
        with self.assertRaises(DomainError):
            variance(state, ddof=4)

    def test_non_finite_observations_are_rejected(self):
        for bad in (math.inf, -math.inf, math.nan):
            with self.subTest(bad=bad):
                with self.assertRaises(DomainError):
                    moments_of([1.0, bad])
                with self.assertRaises(DomainError):
                    push_moment(MomentState(), bad)

    def test_skewness_domain(self):
        with self.assertRaises(DomainError):
            skewness(moments_of([]))
        with self.assertRaises(DomainError):
            skewness(moments_of([1.0, 2.0]))
        with self.assertRaises(DomainError):
            skewness(moments_of([4.0, 4.0, 4.0, 4.0]))


if __name__ == "__main__":
    unittest.main()
