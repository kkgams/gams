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
