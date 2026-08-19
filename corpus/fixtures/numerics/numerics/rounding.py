"""Decimal rounding for reported quantities.

Everything a dashboard shows is eventually rounded, and the rounding has to be
reproducible and total-preserving: a pie chart whose slices are rounded
independently very often adds up to 100.1%.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_DOWN, ROUND_FLOOR, ROUND_HALF_EVEN, ROUND_HALF_UP, ROUND_UP, Decimal
from fractions import Fraction
from typing import List, Sequence

from .allocate import largest_remainder, to_exact
from .errors import DomainError

__all__ = [
    "MODES",
    "round_decimal",
    "round_half_even",
    "round_half_up",
    "round_to_step",
    "distribute_decimal",
]

#: Rounding rules understood by :func:`round_decimal`.
MODES = {
    "half_even": ROUND_HALF_EVEN,
    "half_up": ROUND_HALF_UP,
    "down": ROUND_DOWN,
    "up": ROUND_UP,
    "floor": ROUND_FLOOR,
    "ceiling": ROUND_CEILING,
}


def _as_decimal(value) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, Fraction):
        return Decimal(value.numerator) / Decimal(value.denominator)
    if isinstance(value, int):
        return Decimal(value)
    return Decimal(repr(float(value)))


def round_decimal(value, places: int, mode: str = "half_even") -> Decimal:
    """Round ``value`` to ``places`` decimal places under the named rule."""
    if mode not in MODES:
        raise DomainError(f"unknown rounding mode: {mode!r}")
    if places < 0:
        raise DomainError("places must not be negative")
    exponent = Decimal(1).scaleb(-places)
    return _as_decimal(value).quantize(exponent, rounding=MODES[mode])


def round_half_even(value, places: int = 0) -> Decimal:
    """Banker's rounding: halfway cases go to the nearest even last digit."""
    return round_decimal(value, places, "half_even")


def round_half_up(value, places: int = 0) -> Decimal:
    """Commercial rounding: halfway cases go away from zero."""
    return round_decimal(value, places, "half_up")


def round_to_step(value, step: Decimal, mode: str = "half_even") -> Decimal:
    """Round ``value`` to the nearest multiple of ``step``."""
    if step <= 0:
        raise DomainError("step must be positive")
    ratio = _as_decimal(value) / step
    return round_decimal(ratio, 0, mode) * step


def distribute_decimal(amount: Decimal, weights: Sequence, places: int = 2) -> List[Decimal]:
    """Split ``amount`` in proportion to ``weights`` with no residue.

    The amount is scaled to whole units of ``10 ** -places``, apportioned with
    :func:`numerics.allocate.largest_remainder`, then scaled back, so the parts
    always add up to ``amount`` exactly.
    """
    if places < 0:
        raise DomainError("places must not be negative")
    scaled = _as_decimal(amount).scaleb(places)
    if scaled != scaled.to_integral_value():
        raise DomainError("amount has more precision than the requested places")
    units = int(scaled)
    sign = -1 if units < 0 else 1
    shares = largest_remainder([to_exact(w) for w in weights], abs(units))
    exponent = Decimal(1).scaleb(-places)
    return [(Decimal(sign * share) * exponent).quantize(exponent) for share in shares]
