import unittest
from pathlib import Path

from capacity.config import (
    ACTIVE_ENVIRONMENT,
    BYTES_PER_KIB,
    BYTES_PER_MIB,
    ConfigError,
    DEFAULTS,
    environment_config_path,
    load_config,
    overridden_fields,
    read_overrides,
)
from tests.helpers import make_config


class LayeringTest(unittest.TestCase):
    def test_environment_file_path_follows_active_environment(self):
        self.assertEqual(
            environment_config_path(), Path("conf") / f"{ACTIVE_ENVIRONMENT}.toml"
        )

    def test_only_listed_fields_are_overridden(self):
        cfg = load_config()
        listed = set(overridden_fields(environment_config_path()))
        for name, default in DEFAULTS.items():
            if name in listed or name == "price_tiers":
                continue
            self.assertEqual(getattr(cfg, name), default, name)

    def test_every_environment_file_parses_and_names_known_fields(self):
        for path in sorted(Path("conf").glob("*.toml")):
            self.assertTrue(read_overrides(path), path)

    def test_unknown_field_is_rejected(self):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as fh:
            fh.write("retention_dayz = 3\n")
            name = fh.name
        with self.assertRaises(ConfigError):
            read_overrides(name)


class UnitTest(unittest.TestCase):
    def test_batch_max_bytes_is_kibibytes(self):
        cfg = make_config(batch_max_kib=250)
        self.assertEqual(cfg.batch_max_bytes, 250 * BYTES_PER_KIB)
        self.assertEqual(cfg.batch_max_bytes, 256000)

    def test_shard_byte_ceiling_is_mebibytes(self):
        cfg = make_config(shard_max_mib_per_second=2.0)
        self.assertEqual(cfg.shard_max_bytes_per_second, 2 * BYTES_PER_MIB)
        self.assertEqual(cfg.shard_max_bytes_per_second, 2097152)


class ValidationTest(unittest.TestCase):
    def test_rejects_zero_compression(self):
        from capacity.config import validate

        with self.assertRaises(ConfigError):
            validate(make_config(compression_ratio=0))

    def test_rejects_bounded_last_tier(self):
        from capacity.config import validate

        with self.assertRaises(ConfigError):
            validate(make_config(price_tiers=((10, "0.02"),)))

    def test_rejects_replication_below_one(self):
        from capacity.config import validate

        with self.assertRaises(ConfigError):
            validate(make_config(replication_factor=0))


if __name__ == "__main__":
    unittest.main()
