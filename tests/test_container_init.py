from __future__ import annotations

import contextlib
import io
import json
import os
import re
import stat
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import container_init


class ContainerInitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.secrets_dir = Path(self.temp_dir.name) / "secrets"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_fresh_init_and_rerun_preserve_all_values(self) -> None:
        container_init.initialize(self.secrets_dir)
        first = {path.name: path.read_bytes() for path in self.secrets_dir.iterdir()}

        self.assertEqual(len(first), 13)
        for product in container_init.PRODUCTS:
            password = first[f"{product}_db_password"].decode("ascii")
            self.assertRegex(password, re.compile(r"^[a-fA-F0-9]{64}$"))
            self.assertEqual(
                first[f"{product}_database_url"].decode("ascii"),
                f"postgresql+psycopg://ordivant:{password}@{product}-db:5432/ordivant",
            )
        for name in container_init.TOKEN_FILES:
            self.assertRegex(first[name].decode("ascii"), re.compile(r"^[a-fA-F0-9]{64}$"))
        self.assertEqual(json.loads(first["gitea.json"]), {})

        container_init.initialize(self.secrets_dir)
        second = {path.name: path.read_bytes() for path in self.secrets_dir.iterdir()}
        self.assertEqual(first, second)

        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.secrets_dir.stat().st_mode), 0o700)
            for path in self.secrets_dir.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644, path.name)

    def test_existing_restricted_files_keep_values_and_gain_readable_mode(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        existing = self.secrets_dir / "identity_service_token"
        value = "a" * 64
        existing.write_text(value, encoding="utf-8")
        if os.name == "posix":
            existing.chmod(0o600)

        container_init.initialize(self.secrets_dir)

        self.assertEqual(existing.read_text(encoding="utf-8"), value)
        if os.name == "posix":
            self.assertEqual(stat.S_IMODE(self.secrets_dir.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(existing.stat().st_mode), 0o644)

    def test_existing_database_url_supplies_its_missing_password_file(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        password = "a" * 64
        url_path = self.secrets_dir / "work_database_url"
        url_path.write_text(
            f"postgresql+psycopg://ordivant:{password}@work-db:5432/ordivant",
            encoding="utf-8",
        )

        container_init.initialize(self.secrets_dir)

        self.assertEqual((self.secrets_dir / "work_db_password").read_text(encoding="utf-8"), password)
        self.assertEqual(url_path.read_text(encoding="utf-8"), f"postgresql+psycopg://ordivant:{password}@work-db:5432/ordivant")

    def test_database_password_mismatch_fails_before_creating_missing_files(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        password = "a" * 64
        other_password = "b" * 64
        (self.secrets_dir / "work_db_password").write_text(password, encoding="utf-8")
        (self.secrets_dir / "work_database_url").write_text(
            f"postgresql+psycopg://ordivant:{other_password}@work-db:5432/ordivant",
            encoding="utf-8",
        )

        with self.assertRaises(container_init.InitializationError) as error:
            container_init.initialize(self.secrets_dir)

        self.assertNotIn(password, str(error.exception))
        self.assertNotIn(other_password, str(error.exception))
        self.assertEqual({path.name for path in self.secrets_dir.iterdir()}, {"work_db_password", "work_database_url"})

    def test_invalid_secret_is_redacted_and_creates_no_missing_files(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        invalid = "x" * 64
        (self.secrets_dir / "dev_proxy_token").write_text(invalid, encoding="utf-8")
        stdout = io.StringIO()
        stderr = io.StringIO()

        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = container_init.main([str(self.secrets_dir)])

        self.assertEqual(result, 1)
        self.assertNotIn(invalid, stdout.getvalue() + stderr.getvalue())
        self.assertEqual({path.name for path in self.secrets_dir.iterdir()}, {"dev_proxy_token"})

    def test_existing_gitea_json_is_validated_and_preserved(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        config = '{"projects":{"sample":{"gitea":{"url":"http://gitea:3000"}}}}\n'
        path = self.secrets_dir / "gitea.json"
        path.write_text(config, encoding="utf-8")

        container_init.initialize(self.secrets_dir)

        self.assertEqual(path.read_text(encoding="utf-8"), config)

    def test_invalid_gitea_json_fails_before_creating_other_files(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        path = self.secrets_dir / "gitea.json"
        path.write_text('{"token":"not-a-real-token"', encoding="utf-8")

        with self.assertRaises(container_init.InitializationError) as error:
            container_init.initialize(self.secrets_dir)

        self.assertNotIn("not-a-real-token", str(error.exception))
        self.assertEqual({item.name for item in self.secrets_dir.iterdir()}, {"gitea.json"})

    def test_non_regular_existing_path_is_rejected(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        (self.secrets_dir / "identity_service_token").mkdir()

        with self.assertRaisesRegex(container_init.InitializationError, "regular"):
            container_init.initialize(self.secrets_dir)

        self.assertEqual({item.name for item in self.secrets_dir.iterdir()}, {"identity_service_token"})

    def test_symlink_is_rejected_when_supported(self) -> None:
        self.secrets_dir.mkdir(parents=True)
        target = self.secrets_dir / "target"
        target.write_text("z" * 64, encoding="utf-8")
        link = self.secrets_dir / "identity_service_token"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symlink creation is not available")

        with self.assertRaises(container_init.InitializationError):
            container_init.initialize(self.secrets_dir)

        self.assertEqual(target.read_text(encoding="utf-8"), "z" * 64)


if __name__ == "__main__":
    unittest.main()
