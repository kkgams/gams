"""Exercise cleanup against disposable Git checkouts, never the real outputs."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "scripts/package-host.py"


class CleanTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        spec = importlib.util.spec_from_file_location("package_host_clean_test", SOURCE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.module.ROOT = self.root
        self.schema = self.root / "cmd/app/src-tauri/gen/schemas/macOS-schema.json"
        self.module.SCHEMA_FILES = {self.schema}
        for name in ("build.nosync", "tools", "gams_modules"):
            path = self.root / name
            path.mkdir()
            (path / "unmarked").write_text("disposable")
        self.schema.parent.mkdir(parents=True)
        self.schema.write_text("{}")
        (self.schema.parent / "unrelated.json").write_text("keep")
        (self.root / "authored.txt").write_text("keep")

    def clean(self, *extra):
        paths = [self.root / name for name in ("build.nosync", "tools", "gams_modules")]
        self.module.clean(SimpleNamespace(paths=[*paths, self.schema, *extra]))

    def assert_outputs_present(self):
        for name in ("build.nosync", "tools", "gams_modules"):
            self.assertTrue((self.root / name / "unmarked").is_file())

    def test_remove_whole_directories_and_only_known_schemas(self):
        self.clean()
        self.clean()
        for name in ("build.nosync", "tools", "gams_modules"):
            self.assertFalse((self.root / name).exists())
        self.assertFalse(self.schema.exists())
        self.assertEqual((self.schema.parent / "unrelated.json").read_text(), "keep")
        self.assertEqual((self.root / "authored.txt").read_text(), "keep")

    def test_tracked_file_stops_all_deletion(self):
        subprocess.run(["git", "-C", str(self.root), "add", "tools/unmarked"], check=True)
        with self.assertRaisesRegex(ValueError, "tracked"):
            self.clean()
        self.assert_outputs_present()

    def test_nested_symlink_stops_all_deletion(self):
        (self.root / "tools/link").symlink_to(self.root / "authored.txt")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.clean()
        self.assert_outputs_present()

    def test_root_symlink_stops_all_deletion(self):
        link = self.root / "gams_modules"
        (link / "unmarked").unlink()
        link.rmdir()
        link.symlink_to(self.root / "tools", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.clean()
        self.assertTrue((self.root / "build.nosync/unmarked").is_file())

    def test_schema_directory_is_not_removed(self):
        self.schema.unlink()
        self.schema.mkdir()
        with self.assertRaisesRegex(ValueError, "Expected a generated schema file"):
            self.clean()
        self.assert_outputs_present()

    def test_unapproved_path_stops_all_deletion(self):
        with self.assertRaisesRegex(ValueError, "Not an approved"):
            self.clean(self.root / "authored.txt")
        self.assert_outputs_present()

    def test_clean_roots_are_not_packaging_outputs(self):
        for name in ("build.nosync", "tools", "gams_modules"):
            with self.assertRaisesRegex(ValueError, "Not an approved"):
                self.module.checked_output(self.root / name)


if __name__ == "__main__":
    unittest.main()
