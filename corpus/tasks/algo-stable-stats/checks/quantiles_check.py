"""Hidden grader: order statistics."""

import math
import unittest
from fractions import Fraction

from numerics.errors import DomainError, EmptyInputError
from numerics.quantiles import METHODS, median, quantile, quantiles, weighted_quantile

DATASETS = {
    "unit_run": [1.0, 2.0, 3.0, 4.0],
    "decades": [10.0, 20.0, 30.0, 40.0, 50.0],
    "tenths": [0.1, 0.2, 0.3],
    "shuffled": [5.0, 1.0, 9.0, 3.0, 7.0, 2.0],
    "duplicates": [5.0, 5.0, 5.0, 1.0, 9.0],
    "offset": [1e9 + i * 0.1 for i in range(11)],
    "wide": [1e-9, 1.0, 1e9],
    "pair": [-3.5, 2.5],
    "singleton": [42.0],
}

# Exact expected values, derived from the definition rather than from any
# particular implementation.
KNOWN = [
    ([1.0, 2.0, 3.0, 4.0], 0.0, "linear", 1.0),
    ([1.0, 2.0, 3.0, 4.0], 0.25, "linear", 1.75),
    ([1.0, 2.0, 3.0, 4.0], 0.5, "linear", 2.5),
    ([1.0, 2.0, 3.0, 4.0], 0.75, "linear", 3.25),
    ([1.0, 2.0, 3.0, 4.0], 1.0, "linear", 4.0),
    ([1.0, 2.0, 3.0, 4.0], 0.5, "lower", 2.0),
    ([1.0, 2.0, 3.0, 4.0], 0.5, "higher", 3.0),
    ([1.0, 2.0, 3.0, 4.0], 0.5, "midpoint", 2.5),
    ([10.0, 20.0, 30.0, 40.0, 50.0], 0.375, "nearest", 30.0),
    ([10.0, 20.0, 30.0, 40.0, 50.0], 0.625, "nearest", 30.0),
    ([10.0, 20.0, 30.0, 40.0, 50.0], 0.125, "nearest", 10.0),
    ([10.0, 20.0, 30.0, 40.0, 50.0], 0.875, "nearest", 50.0),
    ([10.0, 20.0, 30.0, 40.0, 50.0], 0.5, "nearest", 30.0),
    ([42.0], 0.37, "linear", 42.0),
    ([42.0], 0.37, "nearest", 42.0),
    ([-3.5, 2.5], 0.5, "linear", -0.5),
    ([-3.5, 2.5], 0.5, "midpoint", -0.5),
    ([5.0, 5.0, 5.0, 1.0, 9.0], 0.5, "linear", 5.0),
    ([1e-9, 1.0, 1e9], 0.5, "linear", 1.0),
]

WEIGHTED_KNOWN = [
    ([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 0.5, 2.0),
    ([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 0.0, 1.0),
    ([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 1.0, 3.0),
    ([1.0, 2.0, 3.0], [1.0, 1.0, 1.0], 0.125, 1.0),
    ([10.0, 20.0], [3.0, 1.0], 0.5, 12.5),
    ([10.0, 20.0], [1.0, 3.0], 0.5, 17.5),
    ([0.0, 10.0], [1.0, 1.0], 0.25, 0.0),
    ([0.0, 10.0], [1.0, 1.0], 0.75, 10.0),
    ([0.0, 10.0], [1.0, 1.0], 0.5, 5.0),
]


def _round_half_even(value):
    floor = math.floor(value)
    rest = value - floor
    if rest < Fraction(1, 2):
        return floor
    if rest > Fraction(1, 2):
        return floor + 1
    return floor if floor % 2 == 0 else floor + 1


def reference_quantile(values, p, method):
    """Independent exact reference, built straight from the stated definition."""
    xs = sorted(Fraction(v) for v in values)
    n = len(xs)
    if n == 1:
        return float(xs[0])
    h = Fraction(n - 1) * Fraction(p)
    lo, hi = math.floor(h), math.ceil(h)
    if method == "lower":
        return float(xs[lo])
    if method == "higher":
        return float(xs[hi])
    if method == "nearest":
        return float(xs[_round_half_even(h)])
    if method == "midpoint":
        return float((xs[lo] + xs[hi]) / 2)
    return float(xs[lo] + (h - lo) * (xs[hi] - xs[lo]))


def reference_weighted(values, weights, p):
    pairs = sorted(zip((Fraction(v) for v in values), (Fraction(w) for w in weights)),
                   key=lambda pair: pair[0])
    total = sum((w for _, w in pairs), Fraction(0))
    anchors, running = [], Fraction(0)
    for _, w in pairs:
        running += w
        anchors.append((running - w / 2) / total)
    target = Fraction(p)
    if target <= anchors[0]:
        return float(pairs[0][0])
    if target >= anchors[-1]:
        return float(pairs[-1][0])
    for k in range(len(anchors) - 1):
        left, right = anchors[k], anchors[k + 1]
        if left <= target <= right:
            if right == left:
                return float(pairs[k + 1][0])
            gap = (target - left) / (right - left)
            return float(pairs[k][0] + gap * (pairs[k + 1][0] - pairs[k][0]))
    return float(pairs[-1][0])


PROBES = [Fraction(k, 64) for k in range(65)]


class KnownAnswerTest(unittest.TestCase):
    def test_table(self):
        for values, p, method, expected in KNOWN:
            with self.subTest(values=values[:3], p=p, method=method):
                self.assertEqual(quantile(values, p, method), expected)

    def test_weighted_table(self):
        for values, weights, p, expected in WEIGHTED_KNOWN:
            with self.subTest(values=values, weights=weights, p=p):
                self.assertEqual(weighted_quantile(values, weights, p), expected)


class ExactAgreementTest(unittest.TestCase):
    def test_every_method_matches_the_rational_reference(self):
        for name, values in DATASETS.items():
            for method in METHODS:
                for p in PROBES:
                    with self.subTest(dataset=name, method=method, p=p):
                        self.assertEqual(
                            quantile(values, p, method),
                            reference_quantile(values, p, method),
                        )

    def test_weighted_matches_the_rational_reference(self):
        cases = [
            ([1.0, 2.0, 3.0], [1.0, 1.0, 1.0]),
            ([1.0, 2.0, 3.0], [5.0, 1.0, 2.0]),
            ([0.1, 0.2, 0.3, 0.4], [1.0, 3.0, 1.0, 7.0]),
            ([1e9, 1e9 + 1.0, 1e9 + 2.0], [1.0, 1.0, 1000000.0]),
            ([-5.0, 0.0, 5.0, 10.0], [0.25, 0.25, 0.25, 0.25]),
            ([3.0, 1.0, 2.0], [2.0, 5.0, 1.0]),
        ]
        for values, weights in cases:
            for p in PROBES:
                with self.subTest(values=values[:2], p=p):
                    self.assertEqual(
                        weighted_quantile(values, weights, p),
                        reference_weighted(values, weights, p),
                    )


class MonotonicityTest(unittest.TestCase):
    def test_quantiles_never_decrease_in_p(self):
        for name, values in DATASETS.items():
            for method in METHODS:
                with self.subTest(dataset=name, method=method):
                    got = [quantile(values, p, method) for p in PROBES]
                    for a, b in zip(got, got[1:]):
                        self.assertLessEqual(a, b)

    def test_weighted_quantiles_never_decrease_in_p(self):
        cases = [
            ([1.0, 2.0, 3.0], [5.0, 1.0, 2.0]),
            ([0.1, 0.2, 0.3, 0.4], [1.0, 3.0, 1.0, 7.0]),
            ([1e9, 1e9 + 1.0, 1e9 + 2.0], [1.0, 1.0, 1000000.0]),
        ]
        for values, weights in cases:
            with self.subTest(values=values[:2]):
                got = [weighted_quantile(values, weights, p) for p in PROBES]
                for a, b in zip(got, got[1:]):
                    self.assertLessEqual(a, b)

    def test_results_stay_inside_the_sample_range(self):
        for name, values in DATASETS.items():
            lo, hi = min(values), max(values)
            for method in METHODS:
                for p in PROBES:
                    with self.subTest(dataset=name, method=method, p=p):
                        got = quantile(values, p, method)
                        self.assertGreaterEqual(got, lo)
                        self.assertLessEqual(got, hi)


class OrderIndependenceTest(unittest.TestCase):
    def test_permuting_the_sample_changes_nothing(self):
        base = [5.0, 1.0, 9.0, 3.0, 7.0, 2.0]
        rotations = [base[k:] + base[:k] for k in range(len(base))]
        for method in METHODS:
            expected = quantile(base, 0.4, method)
            for rotated in rotations:
                with self.subTest(method=method, rotated=rotated[0]):
                    self.assertEqual(quantile(rotated, 0.4, method), expected)

    def test_permuting_a_weighted_sample_changes_nothing(self):
        values = [3.0, 1.0, 2.0, 4.0]
        weights = [2.0, 5.0, 1.0, 3.0]
        pairs = list(zip(values, weights))
        for k in range(len(pairs)):
            rotated = pairs[k:] + pairs[:k]
            with self.subTest(k=k):
                self.assertEqual(
                    weighted_quantile([v for v, _ in rotated], [w for _, w in rotated], 0.4),
                    weighted_quantile(values, weights, 0.4),
                )


class BatchAndMedianTest(unittest.TestCase):
    def test_batch_matches_individual_calls(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                ps = [0.0, 0.05, 0.5, 0.95, 1.0]
                self.assertEqual(
                    quantiles(values, ps), [quantile(values, p) for p in ps]
                )

    def test_median_is_the_linear_half_quantile(self):
        for name, values in DATASETS.items():
            with self.subTest(dataset=name):
                self.assertEqual(median(values), quantile(values, 0.5, "linear"))


class DomainTest(unittest.TestCase):
    def test_empty_sample(self):
        with self.assertRaises(EmptyInputError):
            quantile([], 0.5)
        with self.assertRaises(EmptyInputError):
            weighted_quantile([], [], 0.5)

    def test_p_outside_the_unit_interval(self):
        for bad in (-1e-9, 1.0000001, math.nan, -1.0, 2.0):
            with self.subTest(bad=bad):
                with self.assertRaises(DomainError):
                    quantile([1.0, 2.0], bad)
                with self.assertRaises(DomainError):
                    weighted_quantile([1.0, 2.0], [1.0, 1.0], bad)

    def test_unknown_method(self):
        for bad in ("cubic", "LINEAR", "", "median_unbiased"):
            with self.subTest(bad=bad):
                with self.assertRaises(DomainError):
                    quantile([1.0, 2.0], 0.5, bad)

    def test_non_finite_samples(self):
        for bad in (math.inf, -math.inf, math.nan):
            with self.subTest(bad=bad):
                with self.assertRaises(DomainError):
                    quantile([1.0, bad], 0.5)
                with self.assertRaises(DomainError):
                    weighted_quantile([1.0, bad], [1.0, 1.0], 0.5)

    def test_weight_validation(self):
        with self.assertRaises(DomainError):
            weighted_quantile([1.0, 2.0], [1.0], 0.5)
        with self.assertRaises(DomainError):
            weighted_quantile([1.0], [1.0, 1.0], 0.5)
        for bad in (0.0, -1.0, math.inf, math.nan):
            with self.subTest(bad=bad):
                with self.assertRaises(DomainError):
                    weighted_quantile([1.0, 2.0], [1.0, bad], 0.5)


if __name__ == "__main__":
    unittest.main()
