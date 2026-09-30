"""Exercise release notes against real Git history, without GitHub access."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseNotesTests(unittest.TestCase):
    def test_published_baseline_and_complete_first_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
            git('init', '-q', '-b', 'release')
            git('config', 'user.name', 'Author *One*')
            git('config', 'user.email', 'private@example.invalid')
            (root / '.github').mkdir()
            (root / '.github/RELEASE_GUIDE.md').write_text('Install guide\n')
            for version in ('v1.0.0', 'v1.0.1', 'v1.0.2'):
                (root / 'file').write_text(version)
                git('add', '.')
                git('commit', '-qm', f'Change {version}')
                git('tag', version)
            def notes(releases):
                (root / 'releases.json').write_text(json.dumps(releases))
                result = subprocess.run(['python3', str(ROOT / 'scripts/generate-release-notes.py'),
                    '--tag', 'v1.0.2', '--repository', 'kkgams/gams',
                    '--releases', 'releases.json', '--output', 'notes.md'],
                    cwd=root, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return (root / 'notes.md').read_text()
            first = notes([])
            self.assertIn('First published release', first)
            for version in ('v1.0.0', 'v1.0.1', 'v1.0.2'):
                self.assertIn(f'Change {version}', first)
            self.assertIn('Author \\*One\\*', first)
            self.assertNotIn('private@example.invalid', first)
            published = {'tag_name': 'v1.0.0', 'draft': False,
                         'prerelease': False, 'published_at': '2026-01-01'}
            draft = dict(published, tag_name='v1.0.1', draft=True)
            later = notes([published, draft])
            self.assertNotIn('Change v1.0.0', later)
            self.assertIn('Change v1.0.1', later)
            self.assertIn('Change v1.0.2', later)
            self.assertIn('/compare/v1.0.0...v1.0.2', later)
            prerelease = dict(draft, draft=False, prerelease=True)
            self.assertIn('Change v1.0.1', notes([published, prerelease]))

    def test_workflow_fetch_flattens_pages_and_preserves_api_failure(self):
        # Execute the workflow's real fetch pipeline with a CLI-contract double:
        # gh forbids --slurp with --jq/--template before sending any request.
        import os
        import textwrap
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        fetch = workflow.split('          gh api ', 1)[1].split(
            '          python3 scripts/generate-release-notes.py', 1)[0]
        command = 'set -euo pipefail\ngh api ' + textwrap.dedent(fetch)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'dist').mkdir()
            gh = root / 'gh'
            gh.write_text('#!/usr/bin/env python3\n'
                          'import json, os, sys\n'
                          'if "--slurp" in sys.argv and any(x in sys.argv for x in ("--jq", "--template")):\n'
                          '    sys.stderr.write("the --slurp option is not supported with --jq or --template\\n")\n'
                          '    sys.exit(1)\n'
                          'if os.environ.get("API_FAILURE") == "1":\n'
                          '    sys.stderr.write("HTTP 403\\n")\n'
                          '    sys.exit(1)\n'
                          'assert "--paginate" in sys.argv and "--slurp" in sys.argv\n'
                          'print(os.environ["API_PAGES"])\n')
            gh.chmod(0o755)
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       GITHUB_REPOSITORY='kkgams/gams')
            for pages, expected in [([[]], []),
                                    ([[{'tag_name': 'v1.0.0'}], [{'tag_name': 'v1.0.1'}]],
                                     [{'tag_name': 'v1.0.0'}, {'tag_name': 'v1.0.1'}])]:
                env['API_PAGES'] = json.dumps(pages)
                result = subprocess.run(['bash', '-c', command], cwd=root, env=env,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads((root / 'dist/releases.json').read_text()), expected)
            env['API_FAILURE'] = '1'
            result = subprocess.run(['bash', '-c', command], cwd=root, env=env,
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0, 'API errors must not become empty successful results')

    def test_workflow_generates_notes_and_publishes_only_after_tag_gates(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('--title "$GITHUB_REF_NAME"', workflow)
        self.assertIn('--notes-file dist/release-notes.md', workflow)
        self.assertIn('scripts/generate-release-notes.py', workflow)
        self.assertIn('gh release create "$GITHUB_REF_NAME" --verify-tag', workflow)
        self.assertNotIn('--draft', workflow)
        self.assertNotIn('--latest=false', workflow)
        publishing = workflow.split('  publish-release:\n', 1)[1]
        self.assertTrue(publishing.startswith("    if: startsWith(github.ref, 'refs/tags/v')\n"))
        self.assertIn('needs: macos-candidate', publishing)
        self.assertIn('bash scripts/check-release-absent.sh', publishing)
        self.assertIn('python3 scripts/check-candidate-notices.py', publishing)
        self.assertIn('gh api --paginate --slurp', workflow)
