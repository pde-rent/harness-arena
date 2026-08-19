import math
import unittest

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


class BasicMomentsTest(unittest.TestCase):
    def test_empty_state(self):
        state = moments_of([])
        self.assertEqual(state.n, 0)
        with self.assertRaises(EmptyInputError):
            mean(state)
        with self.assertRaises(EmptyInputError):
            variance(state)

    def test_mean_and_variance_of_small_sample(self):
        state = moments_of([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0])
        self.assertEqual(mean(state), 5.0)
        self.assertAlmostEqual(variance(state), 4.0)
        self.assertAlmostEqual(stdev(state), 2.0)

    def test_sample_variance_uses_ddof(self):
        state = moments_of([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(variance(state, ddof=0), 1.25)
        self.assertAlmostEqual(variance(state, ddof=1), 5.0 / 3.0)

    def test_ddof_that_removes_all_freedom_is_rejected(self):
        state = moments_of([1.0, 2.0])
        with self.assertRaises(DomainError):
            variance(state, ddof=2)

    def test_non_finite_observation_is_rejected(self):
        with self.assertRaises(DomainError):
            moments_of([1.0, math.inf])
        with self.assertRaises(DomainError):
            push_moment(MomentState(), math.nan)

    def test_constant_sample_has_zero_variance(self):
        state = moments_of([3.0] * 10)
        self.assertEqual(variance(state), 0.0)


class ShiftedDataTest(unittest.TestCase):
    def test_variance_survives_a_large_offset(self):
        base = [1.0, 2.0, 3.0, 4.0]
        offset = 1e9
        plain = variance(moments_of(base))
        shifted = variance(moments_of([x + offset for x in base]))
        self.assertEqual(plain, shifted)


class MergeTest(unittest.TestCase):
    def test_merge_with_empty_is_identity(self):
        state = moments_of([1.0, 2.0, 3.0])
        self.assertEqual(merge_moments(state, MomentState()), state)
        self.assertEqual(merge_moments(MomentState(), state), state)

    def test_merge_reproduces_single_pass_on_a_clean_split(self):
        values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        whole = moments_of(values)
        merged = merge_moments(moments_of(values[:2]), moments_of(values[2:]))
        self.assertEqual(merged.n, whole.n)
        self.assertAlmostEqual(merged.mean, whole.mean)
        self.assertAlmostEqual(merged.m2, whole.m2)
        self.assertAlmostEqual(merged.m3, whole.m3)

    def test_merge_many_folds_left(self):
        values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        chunks = [moments_of(values[0:1]), moments_of(values[1:4]), moments_of(values[4:])]
        merged = merge_many_moments(chunks)
        self.assertEqual(merged.n, 6)
        self.assertAlmostEqual(merged.mean, 3.5)


class SkewnessTest(unittest.TestCase):
    def test_symmetric_sample_has_zero_skew(self):
        self.assertAlmostEqual(skewness(moments_of([1.0, 2.0, 3.0, 4.0, 5.0])), 0.0)

    def test_right_tail_is_positively_skewed(self):
        self.assertGreater(skewness(moments_of([1.0, 1.0, 1.0, 10.0])), 0.0)

    def test_too_few_observations(self):
        with self.assertRaises(DomainError):
            skewness(moments_of([1.0, 2.0]))

    def test_zero_variance_sample(self):
        with self.assertRaises(DomainError):
            skewness(moments_of([4.0, 4.0, 4.0, 4.0]))


if __name__ == "__main__":
    unittest.main()
