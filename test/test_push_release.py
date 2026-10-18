"""Offline release-helper tests: real local Git, fake remote Git/GitHub only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
REAL_GIT = shutil.which('git')


class PushReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.log = self.base / 'calls.jsonl'
        self.env = os.environ.copy()
        for key in list(self.env):
            if key.startswith('GIT_'):
                del self.env[key]
        self.env.update(PATH=str(self.bin) + os.pathsep + self.env['PATH'],
                        REAL_GIT=REAL_GIT, CALL_LOG=str(self.log),
                        GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
                        GH_PAGES='[[]]')
        wrapper = '''#!/usr/bin/env python3
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as log:
    log.write(json.dumps([name, *args]) + '\\n')
if name == 'gh':
    if args[0] == 'auth':
        sys.exit(int(os.environ.get('AUTH_STATUS', '0')))
    if args == ['api', '--hostname', 'github.com', '--method', 'GET', 'repos/kkgams/gams']:
        print(os.environ.get('REPO_DATA', '{"full_name":"kkgams/gams","permissions":{"push":true}}'))
        sys.exit(int(os.environ.get('API_STATUS', '0')))
    assert args == ['api', '--hostname', 'github.com', '--method', 'GET', '--paginate', '--slurp', 'repos/kkgams/gams/releases?per_page=100'], args
    change = os.environ.get('CHANGE_DURING_API')
    if change == 'dirty':
        pathlib.Path('late-change').write_text('Changed during preflight')
    elif change == 'branch':
        import subprocess
        subprocess.run([os.environ['REAL_GIT'], 'branch', '-m', 'changed'], check=True)
    elif change == 'head':
        import subprocess
        subprocess.run([os.environ['REAL_GIT'], 'commit', '--allow-empty', '-qm', 'Concurrent commit'], check=True)
    print(os.environ['GH_PAGES'])
    sys.exit(int(os.environ.get('API_STATUS', '0')))
if args[0] == 'ls-remote':
    assert args == ['ls-remote', '--refs', 'origin', 'refs/tags/' + os.environ.get('EXPECTED_TAG', 'v1.2.3')], args
    print(os.environ.get('REMOTE_TAG', ''), end='')
    sys.exit(int(os.environ.get('REMOTE_STATUS', '0')))
if args[0] == 'push':
    sys.exit(int(os.environ.get('PUSH_STATUS', '0')))
os.execv(os.environ['REAL_GIT'], [os.environ['REAL_GIT'], *args])
'''
        for name in ('gh', 'git'):
            path = self.bin / name
            path.write_text(wrapper)
            path.chmod(0o755)
        self.git('init', '-q', '-b', 'work/release')
        self.git('config', 'user.name', 'Release Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('remote', 'add', 'origin', 'git@github.com:kkgams/gams.git')
        self.metadata = self.repo / 'cmd/app/src-tauri'
        self.metadata.mkdir(parents=True)
        self.set_versions('1.2.3', '1.2.3')
        (self.repo / 'scripts').mkdir()
        shutil.copy2(ROOT / 'scripts/push-release.sh', self.repo / 'scripts/push-release.sh')
        self.commit()

    def git(self, *args):
        return subprocess.check_output([REAL_GIT, *args], cwd=self.repo,
                                       env=self.env, stderr=subprocess.PIPE, text=True).strip()

    def set_versions(self, cargo, tauri):
        (self.metadata / 'Cargo.toml').write_text(f'[package]\nname = "gams"\nversion = "{cargo}"\n')
        (self.metadata / 'tauri.conf.json').write_text(json.dumps({'version': tauri}))

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-qm', 'Test fixture')

    def run_script(self, *args, success=True):
        result = subprocess.run(['bash', 'scripts/push-release.sh', *args],
                                cwd=self.repo, env=self.env, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_no_mutations(self):
        self.assertEqual(self.git('tag', '--list'), '')
        self.assertFalse(any(call[1] in ('push', 'tag', 'fetch') for call in self.calls()))

    def test_default_is_read_only(self):
        before = self.git('show-ref')
        result = self.run_script()
        self.assertIn('Dry run only', result.stdout)
        self.assertEqual(self.git('show-ref'), before)
        self.assert_no_mutations()
        self.assertIn(['gh', 'auth', 'status', '--hostname', 'github.com'], self.calls())

    def test_publish_creates_annotated_tag_and_exact_atomic_push(self):
        self.run_script('--publish')
        self.assertEqual(self.git('cat-file', '-t', 'refs/tags/v1.2.3'), 'tag')
        self.assertEqual(self.git('rev-parse', 'v1.2.3^{commit}'), self.git('rev-parse', 'HEAD'))
        self.assertEqual([call for call in self.calls() if call[1] == 'push'], [
            ['git', 'push', '--atomic', '--no-follow-tags', 'origin',
             self.git('rev-parse', 'HEAD') + ':refs/heads/work/release', 'refs/tags/v1.2.3:refs/tags/v1.2.3']])

    def test_existing_local_tag_at_head_is_not_replaced(self):
        self.git('tag', 'v1.2.3')
        before = self.git('rev-parse', 'v1.2.3')
        self.run_script()
        self.run_script('--publish')
        self.assertEqual(self.git('rev-parse', 'v1.2.3'), before)
        self.assertFalse(any(call[1] == 'tag' for call in self.calls()))

    def test_wrong_local_tag_fails(self):
        self.git('tag', 'v1.2.3')
        (self.repo / 'new').write_text('new commit')
        self.commit()
        self.run_script('--publish', success=False)
        self.assertFalse(any(call[1] == 'push' for call in self.calls()))

    def test_dirty_checkout_fails_for_untracked_unstaged_and_staged(self):
        path = self.repo / 'dirty'
        path.write_text('untracked')
        self.run_script('--publish', success=False)
        self.git('add', 'dirty')
        self.run_script('--publish', success=False)
        self.commit()
        path.write_text('unstaged')
        self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_detached_head_fails(self):
        self.git('checkout', '--detach', '-q')
        self.run_script(success=False)
        self.assert_no_mutations()

    def test_wrong_fetch_and_push_origins_fail(self):
        for setting in ('remote.origin.url', 'remote.origin.pushurl'):
            with self.subTest(setting=setting):
                self.git('config', setting, 'https://github.com/other/gams.git')
                self.run_script('--publish', success=False)
                self.git('config', '--unset-all', setting)
                if setting.endswith('.url'):
                    self.git('config', setting, 'https://github.com/kkgams/gams.git')
        self.assert_no_mutations()

    def test_mirror_origin_fails(self):
        for value in ('true', 'yes', '1'):
            self.git('config', 'remote.origin.mirror', value)
            self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_ambiguous_branch_short_name_preserves_exact_branch(self):
        self.git('tag', 'work/release')
        result = self.run_script()
        self.assertIn(self.git('rev-parse', 'HEAD') + ':refs/heads/work/release ', result.stdout)

    def test_prerelease_and_build_suffixes_are_not_host_release_versions(self):
        for version in ('1.2.3-rc.1', '1.2.3+build.001', '1.2.3-rc.1+build.001'):
            self.set_versions(version, version)
            self.commit()
            self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_missing_committed_metadata_fails(self):
        self.git('rm', 'cmd/app/src-tauri/Cargo.toml')
        self.commit()
        self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_committed_versions_must_match_exact_semver(self):
        for cargo, tauri in [('1.2.3', '1.2.4'), ('01.2.3', '01.2.3'),
                             ('1.2', '1.2'), ('1.2.3-01', '1.2.3-01'),
                             ('v1.2.3', 'v1.2.3'), ('1.2.3 ', '1.2.3 ')]:
            with self.subTest(cargo=cargo, tauri=tauri):
                self.set_versions(cargo, tauri)
                self.commit()
                self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_remote_tag_and_any_exact_release_block_publication(self):
        self.env['REMOTE_TAG'] = 'a' * 40 + '\trefs/tags/v1.2.3\n'
        self.run_script('--publish', success=False)
        del self.env['REMOTE_TAG']
        for extra in ({}, {'draft': True}, {'prerelease': True}):
            self.env['GH_PAGES'] = json.dumps([[{'tag_name': 'v1.2.30'}],
                                              [dict(tag_name='v1.2.3', **extra)]])
            self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_similar_release_is_not_exact_match(self):
        self.env['GH_PAGES'] = '[[{"tag_name":"v1.2.30"}], [{"tag_name":"v1.2.3-rc.1"}]]'
        self.run_script()
        self.assert_no_mutations()

    def test_auth_api_and_transport_errors_fail_closed(self):
        for key in ('AUTH_STATUS', 'API_STATUS', 'REMOTE_STATUS'):
            for status in ('1', '2', '128'):
                with self.subTest(key=key, status=status):
                    self.env[key] = status
                    self.run_script('--publish', success=False)
                    del self.env[key]
        self.assert_no_mutations()

    def test_draft_visibility_requires_valid_repository_push_permission(self):
        for response in ('{}', 'null', 'not json',
                         '{"full_name":"kkgams/gams","permissions":{"push":false}}',
                         '{"full_name":"other/gams","permissions":{"push":true}}'):
            self.env['REPO_DATA'] = response
            self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_malformed_api_responses_fail_closed(self):
        for response in ('', 'not json', '{}', '[]', '[{}]', '[[{}]]', '[[null]]'):
            with self.subTest(response=response):
                self.env['GH_PAGES'] = response
                self.run_script('--publish', success=False)
        self.assert_no_mutations()

    def test_checkout_changes_during_preflight_block_mutation(self):
        for mode in ('dirty', 'branch', 'head'):
            with self.subTest(mode=mode):
                self.env['CHANGE_DURING_API'] = mode
                self.run_script('--publish', success=False)
                self.assert_no_mutations()
                if mode == 'dirty':
                    (self.repo / 'late-change').unlink()
                elif mode == 'branch':
                    self.git('branch', '-m', 'work/release')
        del self.env['CHANGE_DURING_API']

    def test_failed_atomic_push_does_not_fall_back(self):
        self.env['PUSH_STATUS'] = '128'
        self.run_script('--publish', success=False)
        self.assertEqual(len([call for call in self.calls() if call[1] == 'push']), 1)
        self.assertEqual(self.git('cat-file', '-t', 'v1.2.3'), 'tag')

    def test_unknown_arguments_fail(self):
        for args in (('--force',), ('--publish', 'extra'), ('', 'extra')):
            self.run_script(*args, success=False)
        self.assertEqual(self.git('tag', '--list'), '')


if __name__ == '__main__':
    unittest.main()
