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
            for name in (checker.FILES[0],
                         'cmd/app/src/util/vendor/zipjs/zip-native.js',
                         'cmd/app/src/util/vendor/zipjs/LICENSE',
                         'cmd/app/src/util/vendor/zipjs/zlib-streams-ts.LICENSE',
                         'cmd/app/src/util/vendor/zipjs/PROVENANCE.md'):
                self.assertIn(name, checker.FILES)
                linked = root / name
                original = linked.read_bytes()
                linked.write_text('replaced after approval\n')
                self.assertNotEqual(check().returncode, 0, name)
                linked.write_bytes(original)
                linked.unlink()
                self.assertNotEqual(check().returncode, 0, name)
                linked.write_bytes(original)

    def test_adhoc_signature_pipeline_consumes_verbose_output(self):
        import shlex
        script = (ROOT / 'scripts/check-mac-bundle.sh').read_text()
        pipeline = next(line.split(' || {', 1)[0] for line in script.splitlines()
                        if line.startswith('/usr/bin/codesign -dv '))
        producer = "import sys; sys.stdout.write('Signature=adhoc\\n' + 'verbose detail\\n' * 100000)"
        command = pipeline.replace('/usr/bin/codesign -dv --verbose=4 "$app"',
                                   'python3 -c ' + shlex.quote(producer))
        result = subprocess.run(['bash', '-o', 'pipefail', '-c', command],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_candidate_requires_exact_zipjs_notices(self):
        pairs = {name: ROOT / name for name in
                 ('LICENSE', 'NOTICE', 'NOTICE-EVIDENCE.sha256', 'NATIVE-NOTICES.md')}
        pairs['FONT-PROVENANCE.md'] = ROOT / 'cmd/app/src/fonts/PROVENANCE.md'
        pairs['FONT-LICENSES/GAME-ICONS-PROVENANCE.md'] = ROOT / 'cmd/app/src/fonts/GAME-ICONS-PROVENANCE.md'
        pairs['FONT-LICENSES/game-icons.json'] = ROOT / 'cmd/app/src/fonts/game-icons.json'
        pairs['BUNDLE-LICENSES/aseprite-reference.LICENSE'] = ROOT / 'cmd/app/src/util/aseprite.LICENSE'
        pairs['BUNDLE-LICENSES/markdown-it/markdown-it.LICENSE'] = ROOT / 'cmd/app/src/widgets/markdown-it.LICENSE'
        for destination, directory, pattern in (
            ('NATIVE-SOURCE', 'NATIVE-SOURCE', '*'),
            ('FONT-LICENSES', 'cmd/app/src/fonts/licenses', '*.txt'),
            ('BUNDLE-LICENSES/ajv', 'cmd/app/src/util/licenses', '*.LICENSE'),
            ('BUNDLE-LICENSES/markdown-it', 'cmd/app/src/widgets/licenses', '*.LICENSE'),
        ):
            for source in (ROOT / directory).glob(pattern):
                pairs[f'{destination}/{source.name}'] = source
        for destination, source in (
            ('ajv', 'cmd/app/src/util/BUNDLE-REVIEW.md'),
            ('markdown-it', 'cmd/app/src/widgets/BUNDLE-REVIEW.md'),
        ):
            pairs[f'BUNDLE-LICENSES/{destination}/PROVENANCE.md'] = ROOT / source
        zip_members = [
            'FONT-LICENSES/GAME-ICONS-PROVENANCE.md', 'FONT-LICENSES/game-icons.json',
            'FONT-LICENSES/game-icons.contributors.txt',
            'FONT-LICENSES/game-icons.CC-BY-3.0.txt', 'FONT-LICENSES/game-icons.CC0-1.0.txt',
        ]
        for name in ('LICENSE', 'zlib-streams-ts.LICENSE', 'PROVENANCE.md'):
            member = f'BUNDLE-LICENSES/zipjs/{name}'
            pairs[member] = ROOT / 'cmd/app/src/util/vendor/zipjs' / name
            zip_members.append(member)
        staging = (ROOT / 'scripts/stage-mac-candidate.sh').read_text()
        self.assertIn('"$output/stage/BUNDLE-LICENSES/zipjs/"', staging)
        for name in ('LICENSE', 'zlib-streams-ts.LICENSE', 'PROVENANCE.md'):
            self.assertIn(f'cmd/app/src/util/vendor/zipjs/{name}', staging)
        with tempfile.TemporaryDirectory() as temporary:
            archive_path = Path(temporary) / 'candidate.zip'
            def check(omit=None, alter=None):
                with ZipFile(archive_path, 'w') as archive:
                    for member, source in pairs.items():
                        if member != omit:
                            archive.writestr(member, b'changed notice' if member == alter
                                             else source.read_bytes())
                return subprocess.run(['python3', str(ROOT / 'scripts/check-candidate-notices.py'),
                                       str(archive_path)], cwd=ROOT, capture_output=True, text=True)
            result = check()
            self.assertEqual(result.returncode, 0, result.stderr)
            for member in zip_members:
                self.assertNotEqual(check(omit=member).returncode, 0, member)
                self.assertNotEqual(check(alter=member).returncode, 0, member)

    def test_tag_release_preserves_history_audit_without_branch_head_gate(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertNotIn('git fetch ', workflow)
        self.assertNotIn('refs/heads/', workflow)
        self.assertNotIn('branches:', workflow)
        self.assertEqual(workflow.count('fetch-depth: 0'), 2)
        self.assertEqual(workflow.count('python3 scripts/check-source-boundary.py'), 2)
        self.assertEqual(workflow.count('bash scripts/check-release-metadata.sh'), 2)

    def test_tag_workflow_rebuilds_and_checks_without_approval_variables(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn("tags: ['v*']", workflow)
        self.assertNotIn('workflow_dispatch:', workflow)
        self.assertNotIn('APPROVED_', workflow)
        self.assertNotIn('vars.', workflow)
        self.assertIn('make app-check app-test app-bundle-release APP_BUNDLES=app', workflow)
        self.assertIn("save-if: 'false'", workflow)
        for script in ('check-native-notices.py', 'check-mpl-source.py', 'check-notice-evidence.py'):
            self.assertEqual(workflow.count(f'python3 scripts/{script}'), 2)

    def test_branch_candidates_do_not_depend_on_a_release_branch_or_digest_variables(self):
        workflow = (ROOT / '.github/workflows/verify.yml').read_text()
        self.assertIn("branches: ['**']", workflow)
        self.assertNotIn('APPROVED_', workflow)
        self.assertNotIn('vars.', workflow)
        self.assertNotIn('refs/heads/release', workflow)
        self.assertIn('run: bash scripts/check-licensing.sh', workflow)
        self.assertIn('nix develop --command bash scripts/stage-mac-candidate.sh', workflow)

    def test_matching_tag_uses_committed_licenses_without_external_approval(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            for name in ("check-licensing.sh", "check-release-metadata.sh"):
                shutil.copy2(ROOT / "scripts" / name, root / "scripts" / name)
            shutil.copy2(ROOT / "LICENSE", root / "LICENSE")
            (root / "NOTICE").write_text("TEST ONLY — not a redistribution notice\n")
            (root / "cmd/app/src-tauri").mkdir(parents=True)
            config = root / "cmd/app/src-tauri/tauri.conf.json"
            config.write_text(json.dumps({"identifier": "com.github.kkgams.gams", "version": "2.0.8"}))
            (root / "cmd/app/src-tauri/Cargo.toml").write_text('[package]\nversion = "2.0.8"\n')
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, stderr=subprocess.PIPE, text=True).strip()
            git('init', '-q', '-b', 'feature/tag-only')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            git('add', '.')
            git('commit', '-qm', 'Version commit')
            git('tag', 'v2.0.8')
            env = {key: value for key, value in os.environ.items() if not key.startswith("APPROVED_")}
            env.update(GITHUB_REPOSITORY="kkgams/gams", GITHUB_EVENT_NAME="push",
                       GITHUB_REF_TYPE="tag", GITHUB_REF="refs/tags/v2.0.8", GITHUB_SHA=git('rev-parse', 'HEAD'))
            def check():
                return subprocess.run(["bash", "scripts/check-release-metadata.sh"], cwd=root,
                                      env=env, capture_output=True, text=True)
            result = check()
            self.assertEqual(result.returncode, 0, result.stderr)
            env["GITHUB_SHA"] = "0" * 40
            self.assertNotEqual(check().returncode, 0)
            env["GITHUB_SHA"] = git('rev-parse', 'HEAD')
            git('commit', '--allow-empty', '-qm', 'New branch tip, tag unchanged')
            env["GITHUB_SHA"] = git('rev-parse', 'HEAD')
            self.assertNotEqual(check().returncode, 0, 'tag must match the checkout even without a branch-head gate')
            git('checkout', '--detach', '-q', 'v2.0.8')
            env["GITHUB_SHA"] = git('rev-parse', 'HEAD')
            self.assertEqual(check().returncode, 0)
            for tag in ("v2.0.7", "v02.0.8", "v2.0.8-rc.1"):
                env["GITHUB_REF"] = f"refs/tags/{tag}"
                self.assertNotEqual(check().returncode, 0, tag)
            env["GITHUB_REF"] = "refs/tags/v2.0.8"
            env["GITHUB_REPOSITORY"] = "someone-else/gams"
            self.assertNotEqual(check().returncode, 0)
            env["GITHUB_REPOSITORY"] = "kkgams/gams"
            (root / "NOTICE").write_text("")
            self.assertNotEqual(check().returncode, 0)
            (root / "NOTICE").unlink()
            (root / "NOTICE").symlink_to(root / "LICENSE")
            self.assertNotEqual(check().returncode, 0)
            (root / "NOTICE").unlink()
            (root / "NOTICE").write_text("Test notice\n")
            config.write_text(json.dumps({"identifier": "com.github.kkgams.gams", "version": "2.0.9"}))
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
