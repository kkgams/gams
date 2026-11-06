import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


class NativeNoticesTests(unittest.TestCase):
    def test_build_preserves_unicode_with_windows_default_encoding(self):
        spec = importlib.util.spec_from_file_location(
            "build_native_notices", ROOT / "scripts/build-native-notices.py"
        )
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        metadata = {
            "crates": [{"package": {
                "name": "example", "version": "1.0.0", "source": "registry+example",
                "id": "example",
            }, "license": "MIT"}],
            "licenses": [{"id": "MIT", "text": "Copyright Ł 日本語",
                          "used_by": [{"crate": {"id": "example"}}]}],
        }
        read_text, write_text = Path.read_text, Path.write_text

        def windows_read(path, encoding=None, **kwargs):
            return read_text(path, encoding=encoding or "cp1252", **kwargs)

        def windows_write(path, data, encoding=None, **kwargs):
            return write_text(path, data, encoding=encoding or "cp1252", **kwargs)

        def cargo_about(command, **kwargs):
            Path(command[-1]).write_bytes(json.dumps(metadata, ensure_ascii=False).encode("utf-8"))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "scripts/generate-native-notices.py").write_bytes(
                (ROOT / "scripts/generate-native-notices.py").read_bytes()
            )
            lock = root / "cmd/app/src-tauri/Cargo.lock"
            lock.parent.mkdir(parents=True)
            lock.write_bytes(b'[[package]]\nname = "example"\nversion = "1.0.0"\n')
            output = root / "build.nosync/notices/NATIVE-NOTICES.md"
            with patch.object(builder, "__file__", str(root / "scripts/build-native-notices.py")), \
                    patch("sys.argv", ["build-native-notices.py", "--target", "x86_64-pc-windows-msvc",
                                       "--output", str(output)]), \
                    patch.object(builder.subprocess, "run", side_effect=cargo_about), \
                    patch.object(Path, "read_text", windows_read), \
                    patch.object(Path, "write_text", windows_write):
                builder.main()
            self.assertIn("Copyright Ł 日本語", output.read_bytes().decode("utf-8"))
            self.assertIn("x86_64-pc-windows-msvc", (output.parent / "NATIVE-SOURCE/README.md").read_bytes().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
