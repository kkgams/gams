"""Native filesystem tests for the production static browser Host assembler."""

import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_web", ROOT / "scripts/build-web.py")
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)


class BuildWebTests(unittest.TestCase):
    def setUp(self):
        build = ROOT / 'build.nosync'
        build.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='test-build-web-', dir=build)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.site = self.root / 'build.nosync/browser-jco/site'
        self.host = self.root / 'cmd/app/src'
        self.output = self.root / 'build.nosync/web'
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.put('scripts/package-host.py', (ROOT / 'scripts/package-host.py').read_bytes())
        for name in web.HOST_REQUIRED:
            self.put(f'cmd/app/src/{name}', b'canonical required asset')
        self.put('cmd/app/src/app.js', b'canonical app')
        for directory in web.HOST_DIRECTORIES:
            self.put(f'cmd/app/src/{directory}/runtime.js', b'canonical helper')
        self.put('cmd/app/src/___/services.js', b'canonical services')
        self.put('cmd/app/src/fonts/fonts.css', b'@font-face{}')
        self.put('cmd/app/src/fonts/example.woff2', b'font bytes')
        self.put('cmd/app/src/fonts/licenses/font.OFL.txt', b'font terms')
        self.put('cmd/app/src/util/vendor/zipjs/LICENSE', b'zip terms')
        self.put('cmd/app/src/util/vendor/zipjs/PROVENANCE.md', b'zip provenance')
        for name in web.GENERATED:
            self.site_put(name, b'generated ' + name.encode())
        self.site_put('browser.html', b'<html><script src="/browser-launch.js"></script></html>')
        self.put('promo/favicon.svg', b'<svg/>')
        for name in ('LICENSE', 'NOTICE'):
            self.put(name, name.encode())
        for dependency in ('jco', 'jco-transpile', 'preview2-shim'):
            for name in ('LICENSE', 'upstream-package.json'):
                self.site_put(f'vendor/licenses/{dependency}/{name}', name.encode())
        self.plugins = []
        config_plugins = []
        for name in ('plugin.fs', 'plugin.layout'):
            base = f'plugins/{name}/v1.0.0'
            assets = []
            for asset in (f'{name}.wasm', 'LICENSE', 'NOTICE'):
                payload = (name + asset).encode()
                self.site_put(f'browser-default/{base}/{asset}', payload)
                assets.append({'name': asset, 'sha256': hashlib.sha256(payload).hexdigest()})
            self.plugins.append({'repository': f'kkgams/{name}', 'tag': 'v1.0.0', 'files': assets})
            config_plugins.append({'$file': f'{base}/{name}.wasm'})
        self.archive = 'unit-sources/view.files/v1.0.0/view.files.zip'
        # The assembler must preserve arbitrary ZIP bytes, never reconstruct it.
        self.zip_bytes = b'PK\x03\x04original release ZIP including license entries\x00'
        self.site_put(f'browser-default/{self.archive}', self.zip_bytes)
        units = [{'repository': 'kkgams/view.files', 'tag': 'v1.0.0',
                  'archive': 'view.files.zip', 'sha256': hashlib.sha256(self.zip_bytes).hexdigest()}]
        self.config = {'plugins': config_plugins, 'ui': {'services': {}, 'views': {
            'view-files': {'url': {'$file': {'url': self.archive, 'entry': 'views/files.js'}}}
        }}}
        self.put('experiments/browser-jco/plugins.json', json.dumps(self.plugins).encode())
        self.put('experiments/browser-jco/view-assets.json', json.dumps(units).encode())
        self.write_config()

    def put(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def site_put(self, name, data):
        return self.put(f'build.nosync/browser-jco/site/{name}', data)

    def write_config(self):
        self.site_put('browser-default/gams.json', json.dumps(self.config).encode())

    def test_assembles_canonical_host_generated_overrides_and_original_project_bytes(self):
        self.site_put('app.js', b'stale experiment copy')
        self.put('cmd/app/src/core/runtime/native.js', b'native transport must be replaced')
        self.assertEqual(web.assemble(self.root), self.output)
        plan = web.asset_plan(self.root)
        files = {path.relative_to(self.output).as_posix() for path in self.output.rglob('*') if path.is_file()}
        self.assertEqual(files, set(plan) | {'_headers', '404.html'})
        for name, source in plan.items():
            self.assertEqual((self.output / name).read_bytes(), source.read_bytes(), name)
        self.assertEqual((self.output / 'app.js').read_bytes(), b'canonical app')
        self.assertEqual((self.output / f'browser-default/{self.archive}').read_bytes(), self.zip_bytes)
        self.assertIn(b'generated core/runtime/native.js', (self.output / 'core/runtime/native.js').read_bytes())
        self.assertIn('Cache-Control: no-store', (self.output / '_headers').read_text())
        self.assertIn('X-Content-Type-Options: nosniff', (self.output / '_headers').read_text())
        self.assertEqual((self.output / '_headers').read_text(), web.HEADERS)
        self.assertIn('404', (self.output / '404.html').read_text())
        self.assertNotIn('<script', (self.output / '404.html').read_text())

    def test_does_not_publish_experiment_or_canonical_nonruntime_files(self):
        for name in ('index.html', 'files.html', 'files-host.js', 'files-transport.js', 'ui.js',
                     'plugins.json', 'view-assets.json', 'dependencies.json',
                     'components/plugin.random.wasm', 'components/standalone.wasm',
                     'vendor/transpiler-worker.js', 'vendor/licenses/plugin.random/LICENSES.zip',
                     'units/view.files/views/files.js', 'browser-default/AGENTS.md',
                     'browser-default/toy.js'):
            self.site_put(name, b'experiment only')
        for name in ('util/BUNDLE-REVIEW.md', 'fonts/licenses/.gitattributes',
                     'core/AGENTS.md', 'util/helper.test.js', 'widgets/source.ts',
                     'widgets/.DS_Store', 'util/package.json'):
            self.put(f'cmd/app/src/{name}', b'not public')
        web.assemble(self.root)
        for name in ('files.html', 'ui.js', 'components', 'units', 'browser.html',
                     'vendor/transpiler-worker.js', 'browser-default/AGENTS.md',
                     'util/BUNDLE-REVIEW.md', 'util/helper.test.js', 'util/package.json'):
            self.assertFalse((self.output / name).exists(), name)
        self.assertEqual((self.output / 'index.html').read_bytes(), (self.site / 'browser.html').read_bytes())

    def test_replaces_only_known_output_and_is_repeatable(self):
        self.put('build.nosync/web/stale.js', b'stale')
        sibling = self.put('build.nosync/unrelated/user.txt', b'preserve')
        for _ in range(2):
            web.assemble(self.root)
            self.assertFalse((self.output / 'stale.js').exists())
            self.assertEqual(sibling.read_bytes(), b'preserve')

    def test_missing_required_input_preserves_previous_publication(self):
        old = self.put('build.nosync/web/old.txt', b'previous')
        (self.site / 'vendor/js-component-bindgen-component.core4.wasm').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing required'):
            web.assemble(self.root)
        self.assertEqual(old.read_bytes(), b'previous')

    def test_missing_canonical_asset_or_release_license_is_rejected(self):
        for path in (self.host / 'css/reset.css',
                     self.site / 'browser-default/plugins/plugin.fs/v1.0.0/LICENSE',
                     self.site / 'vendor/licenses/jco/LICENSE'):
            with self.subTest(path=path):
                payload = path.read_bytes()
                path.unlink()
                try:
                    with self.assertRaisesRegex(ValueError, 'Missing required'):
                        web.assemble(self.root)
                finally:
                    path.write_bytes(payload)

    def test_modified_pinned_release_is_rejected_before_clean(self):
        old = self.put('build.nosync/web/old.txt', b'previous')
        self.site_put(f'browser-default/{self.archive}', b'modified archive')
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            web.assemble(self.root)
        self.assertTrue(old.exists())

    def test_oversized_asset_is_rejected(self):
        path = self.site / 'vendor/browser-worker.js'
        with path.open('wb') as stream:
            stream.truncate(web.MAX_ASSET_BYTES + 1)
        with self.assertRaisesRegex(ValueError, 'exceeds 25 MiB'):
            web.assemble(self.root)
        self.assertFalse(self.output.exists())

    def test_exact_size_limit_is_allowed(self):
        path = self.site / 'vendor/browser-worker.js'
        with path.open('wb') as stream:
            stream.truncate(web.MAX_ASSET_BYTES)
        self.assertEqual(web.regular_file(path), path)

    def test_refuses_input_file_and_directory_symlinks(self):
        for relative in ('browser-launch.js', 'vendor'):
            with self.subTest(relative=relative):
                path = self.site / relative
                moved = path.with_name(path.name + '.original')
                path.rename(moved)
                path.symlink_to(moved, target_is_directory=moved.is_dir())
                try:
                    with self.assertRaisesRegex(ValueError, 'symlink'):
                        web.assemble(self.root)
                finally:
                    path.unlink()
                    moved.rename(path)

    def test_refuses_canonical_directory_symlink(self):
        path = self.host / 'util'
        path.rename(self.host / 'util-original')
        path.symlink_to(self.host / 'util-original', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            web.assemble(self.root)

    def test_refuses_output_and_descendant_symlinks_without_touching_targets(self):
        target = self.put('user-data/keep.txt', b'irreplaceable')
        self.output.symlink_to(target.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            web.assemble(self.root)
        self.output.unlink()
        self.output.mkdir()
        (self.output / 'linked').symlink_to(target.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            web.assemble(self.root)
        self.assertEqual(target.read_bytes(), b'irreplaceable')

    def test_refuses_tracked_output(self):
        tracked = self.put('build.nosync/web/tracked.txt', b'authored')
        subprocess.run(['git', '-C', str(self.root), 'add', '-f', 'build.nosync/web/tracked.txt'], check=True)
        with self.assertRaisesRegex(ValueError, 'tracked path'):
            web.assemble(self.root)
        self.assertEqual(tracked.read_bytes(), b'authored')

    def test_project_paths_cannot_escape_or_request_remote_assets(self):
        for path in ('../secret.zip', '/absolute.zip', 'https://example.test/unit.zip',
                     'unit.zip?token=secret', 'units\\file.zip', './unit.zip'):
            with self.subTest(path=path):
                self.config['ui']['views']['view-files']['url']['$file']['url'] = path
                self.write_config()
                with self.assertRaisesRegex(ValueError, 'Unsafe Project'):
                    web.assemble(self.root)


if __name__ == '__main__':
    unittest.main()
