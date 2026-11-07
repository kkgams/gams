import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location(
    "ci_tools", Path(__file__).resolve().parents[1] / "scripts/install-ci-tools.py"
)
tools = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tools)


class CiToolsTests(unittest.TestCase):
    def test_download_checks_digest_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "tool.zip"
            with patch.object(tools, "urlopen", return_value=io.BytesIO(b"wrong")):
                with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                    tools.download("https://example.test/tool.zip", "0" * 64, destination)
            self.assertFalse(destination.exists())
            payload = b"verified archive"
            with patch.object(tools, "urlopen", return_value=io.BytesIO(payload)):
                tools.download("https://example.test/tool.zip",
                               hashlib.sha256(payload).hexdigest(), destination)
            self.assertEqual(destination.read_bytes(), payload)

    def test_zip_reads_only_executable_without_extracting_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "tool.zip"
            with zipfile.ZipFile(archive, "w") as source:
                source.writestr("tool/cargo-tauri.exe", b"binary")
                source.writestr("../unrelated", b"do not extract")
            self.assertEqual(tools.binary(archive, "cargo-tauri.exe"), b"binary")
            self.assertEqual(list(Path(directory).iterdir()), [archive])
            with self.assertRaisesRegex(ValueError, "exactly one"):
                tools.binary(archive, "missing.exe")
            with zipfile.ZipFile(archive, "a") as source:
                source.writestr("other/cargo-tauri.exe", b"ambiguous")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                tools.binary(archive, "cargo-tauri.exe")

    def test_tar_reads_regular_binary_not_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "tool.tar.gz"
            with tarfile.open(archive, "w:gz") as source:
                member = tarfile.TarInfo("tool/cargo-about")
                member.size = len(b"binary")
                source.addfile(member, io.BytesIO(b"binary"))
                link = tarfile.TarInfo("link/cargo-about")
                link.type = tarfile.SYMTYPE
                link.linkname = "/unrelated"
                source.addfile(link)
            self.assertEqual(tools.binary(archive, "cargo-about"), b"binary")
            with self.assertRaisesRegex(ValueError, "exactly one"):
                tools.binary(archive, "missing")


if __name__ == "__main__":
    unittest.main()
