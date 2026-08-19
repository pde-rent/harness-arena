"""Planner configuration: built-in defaults plus per-environment overrides.

The defaults below describe a small single-tenant development deployment. Real
fleets deviate, so every deployment ships a file under ``conf/<environment>.toml``
that sets the fields it needs to change. Only the fields present in that file are
overridden; everything else keeps its default.

Unit conventions used throughout the package (these are load bearing):

* ``*_bytes``               raw byte counts, base 2 has nothing to do with it
* ``*_kib``                 kibibytes,  1 KiB = 1024 bytes
* ``*_mib_per_second``      mebibytes per second, 1 MiB = 1024 * 1024 bytes
* ``*_gib``                 gibibytes,  1 GiB = 1024 * 1024 * 1024 bytes
* measured event counts in ``data/`` are **per clock hour**, never per second
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any

BYTES_PER_KIB = 1024
BYTES_PER_MIB = 1024 * 1024
BYTES_PER_GIB = 1024 * 1024 * 1024

#: The deployment this planner is currently sizing. ``load_config()`` reads
#: ``conf/<ACTIVE_ENVIRONMENT>.toml``. The other files under ``conf/`` describe
#: deployments that are not being planned here.
ACTIVE_ENVIRONMENT = "prod"

#: Built-in defaults. A deployment overrides a subset of these.
DEFAULTS: dict[str, Any] = {
    # --- fleet selection -------------------------------------------------
    # Rows in data/ingest_rates.csv carry a fleet label. Only this fleet is
    # real customer traffic and counts towards capacity.
    "billable_fleet": "prod",
    # --- payload / compression ------------------------------------------
    # Events are compressed once, on the collector, before they are batched.
    "compression_ratio": 2.0,
    # --- batching --------------------------------------------------------
    # A batch is closed as soon as EITHER limit is reached. Both limits are
    # evaluated against post-compression sizes.
    "batch_max_kib": 250,
    "batch_max_events": 500,
    # --- sharding --------------------------------------------------------
    "shard_max_events_per_second": 4000,
    "shard_max_mib_per_second": 1.0,
    # --- retention -------------------------------------------------------
    # Days of *history* kept in the hot tier, not counting the day in progress.
    "retention_days": 7,
    "replication_factor": 1,
    # --- pricing ---------------------------------------------------------
    # Hot-tier storage is billed per whole GiB per month. The first
    # ``hot_tier_free_gib`` GiB every month cost nothing and are deducted before
    # any tier rate is applied. Tiers are (size of the tier in GiB, USD per GiB);
    # a null size means "everything remaining".
    "hot_tier_free_gib": 1000,
    "price_tiers": [[10000, "0.021"], [40000, "0.017"], [None, "0.012"]],
    # Every provisioned shard is billed whole, whatever its utilisation.
    "shard_monthly_usd": "45.00",
    "monthly_budget_usd": "700.00",
}


@dataclass(frozen=True)
class PlannerConfig:
    billable_fleet: str
    compression_ratio: float
    batch_max_kib: int
    batch_max_events: int
    shard_max_events_per_second: int
    shard_max_mib_per_second: float
    retention_days: int
    replication_factor: int
    hot_tier_free_gib: int
    price_tiers: tuple[tuple[int | None, str], ...]
    shard_monthly_usd: str
    monthly_budget_usd: str

    @property
    def batch_max_bytes(self) -> int:
        """The size limit of a batch, in bytes."""
        return self.batch_max_kib * BYTES_PER_KIB

    @property
    def shard_max_bytes_per_second(self) -> int:
        """The throughput limit of one shard, in bytes per second."""
        return int(self.shard_max_mib_per_second * BYTES_PER_MIB)

    def replace(self, **kw: Any) -> "PlannerConfig":
        merged = {f.name: getattr(self, f.name) for f in fields(self)}
        merged.update(kw)
        return PlannerConfig(**merged)


class ConfigError(ValueError):
    """Raised when a configuration file is unusable."""


_KNOWN = {f.name for f in fields(PlannerConfig)}


def _coerce(raw: dict[str, Any]) -> dict[str, Any]:
    out = dict(raw)
    if "price_tiers" in out:
        out["price_tiers"] = tuple(
            (None if t[0] is None else int(t[0]), str(t[1])) for t in out["price_tiers"]
        )
    for money in ("shard_monthly_usd", "monthly_budget_usd"):
        if money in out:
            out[money] = str(out[money])
    return out


def read_overrides(path: str | Path) -> dict[str, Any]:
    """Parse one environment file and return exactly the fields it sets."""
    p = Path(path)
    with p.open("rb") as fh:
        doc = tomllib.load(fh)
    unknown = sorted(set(doc) - _KNOWN)
    if unknown:
        raise ConfigError(f"{p}: unknown configuration field(s): {', '.join(unknown)}")
    return doc


def overridden_fields(path: str | Path) -> list[str]:
    """The names of the configuration fields set by an environment file."""
    return sorted(read_overrides(path))


def environment_config_path(environment: str | None = None, root: str | Path = "conf") -> Path:
    env = ACTIVE_ENVIRONMENT if environment is None else environment
    return Path(root) / f"{env}.toml"


def load_config(environment: str | None = None, root: str | Path = "conf") -> PlannerConfig:
    """Defaults, with the active environment file layered on top."""
    merged = _coerce(DEFAULTS)
    path = environment_config_path(environment, root)
    if path.exists():
        merged.update(_coerce(read_overrides(path)))
    cfg = PlannerConfig(**merged)
    validate(cfg)
    return cfg


def validate(cfg: PlannerConfig) -> None:
    if cfg.compression_ratio <= 0:
        raise ConfigError("compression_ratio must be positive")
    if cfg.batch_max_kib <= 0 or cfg.batch_max_events <= 0:
        raise ConfigError("batch limits must be positive")
    if cfg.shard_max_events_per_second <= 0 or cfg.shard_max_mib_per_second <= 0:
        raise ConfigError("shard limits must be positive")
    if cfg.retention_days < 0:
        raise ConfigError("retention_days must not be negative")
    if cfg.replication_factor < 1:
        raise ConfigError("replication_factor must be at least 1")
    if cfg.hot_tier_free_gib < 0:
        raise ConfigError("hot_tier_free_gib must not be negative")
    if not cfg.price_tiers:
        raise ConfigError("price_tiers must not be empty")
    if any(size is None for size, _ in cfg.price_tiers[:-1]):
        raise ConfigError("only the last price tier may be unbounded")
    if cfg.price_tiers[-1][0] is not None:
        raise ConfigError("the last price tier must be unbounded")
