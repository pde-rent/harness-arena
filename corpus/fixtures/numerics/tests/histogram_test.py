import math
import unittest

from numerics.errors import DomainError, EmptyInputError
from numerics.histogram import Histogram, LogLinearLayout, histogram_of
from numerics.moments import mean


class LayoutTest(unittest.TestCase):
    def setUp(self):
        self.layout = LogLinearLayout(base=2.0, sub_buckets=2, floor_value=1.0)

    def test_rejects_bad_parameters(self):
        with self.assertRaises(DomainError):
            LogLinearLayout(base=1.0)
        with self.assertRaises(DomainError):
            LogLinearLayout(sub_buckets=0)
        with self.assertRaises(DomainError):
            LogLinearLayout(floor_value=0.0)

    def test_underflow_bucket(self):
        self.assertEqual(self.layout.index(0.5), 0)
        self.assertEqual(self.layout.bounds(0), (0.0, 1.0))

    def test_indices_increase_with_value(self):
        indices = [self.layout.index(x) for x in (1.0, 1.5, 2.0, 4.0, 16.0)]
        self.assertEqual(indices, sorted(indices))
        self.assertEqual(self.layout.index(1.0), 1)

    def test_bounds_bracket_the_value(self):
        for x in (1.0, 1.3, 2.7, 9.9, 100.0):
            low, high = self.layout.bounds(self.layout.index(x))
            self.assertLessEqual(low, x)
            self.assertLess(x, high)

    def test_midpoint_lies_inside_the_bucket(self):
        low, high = self.layout.bounds(3)
        self.assertLess(low, self.layout.midpoint(3))
        self.assertLess(self.layout.midpoint(3), high)

    def test_non_finite_values(self):
        with self.assertRaises(DomainError):
            self.layout.index(math.nan)
        with self.assertRaises(DomainError):
            self.layout.index(math.inf)


class HistogramTest(unittest.TestCase):
    def test_counts_and_moments(self):
        hist = Histogram(LogLinearLayout(base=2.0, sub_buckets=1, floor_value=1.0))
        hist.extend([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(hist.count, 4)
        self.assertEqual(mean(hist.moments), 2.5)

    def test_weighted_add(self):
        hist = Histogram()
        hist.add(1.0, weight=3)
        self.assertEqual(hist.count, 3)
        with self.assertRaises(DomainError):
            hist.add(1.0, weight=0)

    def test_merge_requires_matching_layouts(self):
        a = Histogram(LogLinearLayout(sub_buckets=2))
        b = Histogram(LogLinearLayout(sub_buckets=3))
        with self.assertRaises(DomainError):
            a.merge(b)

    def test_merge_adds_counts_and_moments(self):
        layout = LogLinearLayout(base=2.0, sub_buckets=1, floor_value=1.0)
        a = histogram_of([1.0, 2.0], layout)
        b = histogram_of([3.0, 4.0], layout)
        merged = a.merge(b)
        self.assertEqual(merged.count, 4)
        self.assertAlmostEqual(mean(merged.moments), 2.5)

    def test_total_is_positive_and_finite(self):
        hist = histogram_of([1.0, 2.0, 4.0, 8.0])
        self.assertTrue(math.isfinite(hist.total()))
        self.assertGreater(hist.total(), 0.0)

    def test_bucket_quantile(self):
        layout = LogLinearLayout(base=2.0, sub_buckets=1, floor_value=1.0)
        hist = histogram_of([1.0, 1.0, 1.0, 64.0], layout)
        self.assertLess(hist.bucket_quantile(0.5), hist.bucket_quantile(1.0))

    def test_empty_histogram_has_no_quantiles(self):
        with self.assertRaises(EmptyInputError):
            Histogram().bucket_quantile(0.5)

    def test_quantile_domain(self):
        hist = histogram_of([1.0])
        with self.assertRaises(DomainError):
            hist.bucket_quantile(1.5)


if __name__ == "__main__":
    unittest.main()
