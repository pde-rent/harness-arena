"""Exception hierarchy shared by every module in the toolkit."""

from __future__ import annotations

__all__ = [
    "NumericsError",
    "EmptyInputError",
    "DomainError",
    "AllocationError",
]


class NumericsError(Exception):
    """Base class for every error raised by this library."""


class EmptyInputError(NumericsError):
    """Raised when a statistic is requested from an empty sample."""


class DomainError(NumericsError):
    """Raised when an argument is outside the domain a routine accepts."""


class AllocationError(NumericsError):
    """Raised when an integer allocation cannot satisfy its constraints."""
