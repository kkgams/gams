"""Offline Host publication safety tests. No binaries or network access."""

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest
from zipfile import ZipFile
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]


class HostReleaseTests(unittest.TestCase):
    def test_source_boundary_rejects_removed_game_in_git_ancestry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shutil.copy2(ROOT / 'scripts/check-source-boundary.py', root / 'check.py')
            def git(*args):
                subprocess.run(['git', *args], cwd=root, check=True, capture_output=True)
            git('init', '-q', '-b', 'release')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            (root / 'README.md').write_text('Host only\n')
            git('add', 'README.md')
            git('commit', '-qm', 'Host source')
            def check():
                return subprocess.run(['python3', 'check.py'], cwd=root,
                                      capture_output=True, text=True)
            self.assertEqual(check().returncode, 0)
            (root / 'examples/station-demo').mkdir(parents=True)
            (root / 'examples/station-demo/main.odin').write_text('game source\n')
            self.assertNotEqual(check().returncode, 0)
            git('add', 'examples/station-demo/main.odin')
            git('commit', '-qm', 'Old example')
            git('rm', '-r', 'examples')
            git('commit', '-qm', 'Delete example')
            self.assertNotEqual(check().returncode, 0, 'Deleting the tree must not hide historical game source')

    def test_future_platform_zips_are_readme_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            for platform in ("linux", "windows"):
                output = Path(temporary) / f"{platform}.zip"
                subprocess.run(["python3", str(ROOT / "scripts/next-platform.py"), platform,
                                str(output)], check=True)
                with ZipFile(output) as archive:
                    self.assertEqual(archive.namelist(), ["README.txt"])
                    self.assertIn(b"THIS ZIP CONTAINS NO EXECUTABLE", archive.read("README.txt"))
                self.assertNotEqual(subprocess.run(
                    ["python3", str(ROOT / "scripts/next-platform.py"), platform, str(output)],
                    capture_output=True).returncode, 0)

    def test_native_notice_lock_and_full_text_index_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'scripts').mkdir()
            (root / 'cmd/app/src-tauri').mkdir(parents=True)
            shutil.copy2(ROOT / 'scripts/check-native-notices.py', root / 'scripts')
            lock = root / 'cmd/app/src-tauri/Cargo.lock'
            lock.write_text('locked test graph\n')
            digest = hashlib.sha256(lock.read_bytes()).hexdigest()
            anchor = 'a' * 64
            rows = ''.join(f'| `crate{i}@1.0.0` | `MIT` | [MIT](#license-{anchor}) |\n'
                           for i in range(300))
            notice = root / 'NATIVE-NOTICES.md'
            notice.write_text(f'Cargo.lock SHA-256: `{digest}`\n' + rows
                              + f'### MIT — license-{anchor}\n\nCopyright test\n')
            def check():
                return subprocess.run(['python3', 'scripts/check-native-notices.py'],
                                      cwd=root, capture_output=True).returncode
            self.assertEqual(check(), 0)
            lock.write_text('changed dependency graph\n')
            self.assertNotEqual(check(), 0)
            lock.write_text('locked test graph\n')
            notice.write_text(notice.read_text().replace(f'### MIT — license-{anchor}',
                                                        '### MIT — missing-license'))
            self.assertNotEqual(check(), 0)

    def test_notice_evidence_rejects_changed_linked_license(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'scripts').mkdir()
            shutil.copy2(ROOT / 'scripts/check-notice-evidence.py', root / 'scripts')
            import importlib.util
            spec = importlib.util.spec_from_file_location('notice_check', root / 'scripts/check-notice-evidence.py')
            checker = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(checker)
            for name in checker.FILES:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('reviewed contents\n')
            for pattern, count in checker.GROUPS.items():
                for i in range(count):
                    path = root / pattern.replace('*', f'file{i}')
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('upstream term\n')
            (root / 'NOTICE').write_text('reviewed notice\n')
            def check(*args):
                return subprocess.run(['python3', 'scripts/check-notice-evidence.py', *args],
                                      cwd=root, capture_output=True, text=True)
            self.assertEqual(check('--write-manifest').returncode, 0)
            digest = hashlib.sha256((root / 'NOTICE-EVIDENCE.sha256').read_bytes()).hexdigest()
            (root / 'NOTICE').write_text(f'Third-party evidence SHA-256: `{digest}`\n')
            self.assertEqual(check().returncode, 0)
            linked = root / checker.FILES[0]
            linked.write_text('replaced after approval\n')
            self.assertNotEqual(check().returncode, 0)

    def test_digest_and_version_gates_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            for name in ("check-licensing-digests.sh", "check-release-metadata.sh"):
                shutil.copy2(ROOT / "scripts" / name, root / "scripts" / name)
            shutil.copy2(ROOT / "LICENSE", root / "LICENSE")
            (root / "NOTICE").write_text("TEST ONLY — not a redistribution notice\n")
            (root / "cmd/app/src-tauri").mkdir(parents=True)
            (root / "cmd/app/src-tauri/tauri.conf.json").write_text(
                json.dumps({"identifier": "com.github.kkgams.gams", "version": "2.0.0"}))
            (root / "cmd/app/src-tauri/Cargo.toml").write_text('[package]\nversion = "2.0.0"\n')
            env = os.environ.copy()
            env.update({
                "GITHUB_REPOSITORY": "kkgams/gams",
                "GITHUB_EVENT_NAME": "workflow_dispatch",
                "GITHUB_REF_TYPE": "branch",
                "GITHUB_REF": "refs/heads/release",
                "APPROVED_LICENSE_SHA256": hashlib.sha256((root / "LICENSE").read_bytes()).hexdigest(),
                "APPROVED_NOTICE_SHA256": hashlib.sha256((root / "NOTICE").read_bytes()).hexdigest(),
            })
            def check():
                return subprocess.run(["bash", "scripts/check-release-metadata.sh"], cwd=root,
                                      env=env, capture_output=True, text=True)
            self.assertEqual(check().returncode, 0)
            env["APPROVED_NOTICE_SHA256"] = ""
            self.assertNotEqual(check().returncode, 0)
            env["APPROVED_NOTICE_SHA256"] = hashlib.sha256((root / "NOTICE").read_bytes()).hexdigest()
            env["GITHUB_REF"] = "refs/tags/v0.0.0"
            env["GITHUB_EVENT_NAME"] = "push"
            self.assertNotEqual(check().returncode, 0)
            version = json.loads((root / "cmd/app/src-tauri/tauri.conf.json").read_text())["version"]
            env["GITHUB_REF"] = f"refs/tags/v{version}"
            self.assertEqual(check().returncode, 0)
            env["GITHUB_REPOSITORY"] = "someone-else/gams"
            self.assertNotEqual(check().returncode, 0)

    def test_release_preflight_treats_auth_failure_as_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copy2(ROOT / "scripts/check-release-absent.sh", root / "scripts/check-release-absent.sh")
            (root / "cmd/app/src-tauri").mkdir(parents=True)
            (root / "cmd/app/src-tauri/tauri.conf.json").write_text(
                json.dumps({"version": "2.0.0"}))
            curl = root / "mock-curl"
            curl.write_text("#!/usr/bin/env bash\nprintf '%s' \"$MOCK_STATUS\"\n")
            curl.chmod(0o755)
            env = os.environ.copy()
            version = json.loads((root / "cmd/app/src-tauri/tauri.conf.json").read_text())["version"]
            env.update({"GITHUB_REPOSITORY": "kkgams/gams", "GITHUB_REF_NAME": f"v{version}",
                        "GH_TOKEN": "test-only", "CURL_BIN": str(curl)})
            def check(status):
                env["MOCK_STATUS"] = status
                return subprocess.run(["bash", "scripts/check-release-absent.sh"], cwd=root,
                                      env=env, capture_output=True).returncode
            self.assertEqual(check("404"), 0)
            for status in ("200", "401", "403", "429", "500"):
                self.assertNotEqual(check(status), 0, status)


if __name__ == "__main__":
    unittest.main()
