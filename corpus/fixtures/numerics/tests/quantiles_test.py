import math
import unittest

from numerics.errors import DomainError, EmptyInputError
from numerics.quantiles import METHODS, median, quantile, quantiles, weighted_quantile


class QuantileTest(unittest.TestCase):
    def test_empty_sample(self):
        with self.assertRaises(EmptyInputError):
            quantile([], 0.5)

    def test_single_element_is_every_quantile(self):
        for p in (0.0, 0.25, 0.5, 1.0):
            self.assertEqual(quantile([7.0], p), 7.0)

    def test_endpoints(self):
        data = [4.0, 1.0, 3.0, 2.0]
        self.assertEqual(quantile(data, 0.0), 1.0)
        self.assertEqual(quantile(data, 1.0), 4.0)

    def test_linear_interpolation(self):
        data = [1.0, 2.0, 3.0, 4.0]
        self.assertEqual(quantile(data, 0.25), 1.75)
        self.assertEqual(quantile(data, 0.5), 2.5)
        self.assertEqual(quantile(data, 0.75), 3.25)

    def test_input_order_does_not_matter(self):
        self.assertEqual(quantile([3.0, 1.0, 2.0], 0.5), quantile([1.0, 2.0, 3.0], 0.5))

    def test_methods_on_a_half_index(self):
        data = [1.0, 2.0, 3.0, 4.0]
        self.assertEqual(quantile(data, 0.5, "lower"), 2.0)
        self.assertEqual(quantile(data, 0.5, "higher"), 3.0)
        self.assertEqual(quantile(data, 0.5, "midpoint"), 2.5)

    def test_nearest_breaks_ties_to_the_even_index(self):
        data = [10.0, 20.0, 30.0, 40.0, 50.0]
        # h = 4 * 0.375 = 1.5 -> even index 2
        self.assertEqual(quantile(data, 0.375, "nearest"), 30.0)
        # h = 4 * 0.625 = 2.5 -> even index 2
        self.assertEqual(quantile(data, 0.625, "nearest"), 30.0)

    def test_unknown_method(self):
        with self.assertRaises(DomainError):
            quantile([1.0, 2.0], 0.5, "cubic")

    def test_p_outside_the_unit_interval(self):
        for bad in (-0.001, 1.001, math.nan):
            with self.assertRaises(DomainError):
                quantile([1.0, 2.0], bad)

    def test_non_finite_sample(self):
        with self.assertRaises(DomainError):
            quantile([1.0, math.inf], 0.5)

    def test_every_method_is_listed(self):
        for method in METHODS:
            self.assertIsInstance(quantile([1.0, 2.0, 3.0], 0.5, method), float)

    def test_batch_matches_one_at_a_time(self):
        data = [5.0, 1.0, 9.0, 3.0]
        ps = [0.0, 0.1, 0.5, 0.9, 1.0]
        self.assertEqual(quantiles(data, ps), [quantile(data, p) for p in ps])

    def test_median(self):
        self.assertEqual(median([3.0, 1.0, 2.0]), 2.0)
        self.assertEqual(median([4.0, 1.0, 3.0, 2.0]), 2.5)


class WeightedQuantileTest(unittest.TestCase):
    def test_uniform_weights_centre_on_the_median(self):
        self.assertEqual(weighted_quantile([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 0.5), 2.0)

    def test_extremes_clamp_to_the_end_observations(self):
        self.assertEqual(weighted_quantile([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 0.0), 1.0)
        self.assertEqual(weighted_quantile([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 1.0), 3.0)

    def test_two_observations(self):
        self.assertEqual(weighted_quantile([10.0, 20.0], [3.0, 1.0], 0.5), 12.5)

    def test_weights_are_validated(self):
        with self.assertRaises(DomainError):
            weighted_quantile([1.0, 2.0], [1.0], 0.5)
        with self.assertRaises(DomainError):
            weighted_quantile([1.0, 2.0], [1.0, 0.0], 0.5)
        with self.assertRaises(DomainError):
            weighted_quantile([1.0, 2.0], [1.0, -1.0], 0.5)

    def test_empty_sample(self):
        with self.assertRaises(EmptyInputError):
            weighted_quantile([], [], 0.5)

    def test_input_order_does_not_matter(self):
        a = weighted_quantile([1.0, 2.0, 3.0], [5.0, 1.0, 2.0], 0.4)
        b = weighted_quantile([3.0, 1.0, 2.0], [2.0, 5.0, 1.0], 0.4)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
