"""Native filesystem tests for the production static browser Host assembler."""

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
        self.site = self.root / 'build.nosync/web-build/site'
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
        release = 'https://github.com/kkgams'
        self.config = {
            'plugins': [
                {'$file': f'{release}/{name}/releases/download/v1.0.0/{name}.wasm'}
                for name in ('plugin.fs', 'plugin.layout')
            ],
            'ui': {'services': {}, 'views': {
                'view-files': {'url': {'$file': {
                    'url': f'{release}/view.files/releases/download/v1.0.0/view.files.zip',
                    'entry': 'views/files.js',
                }}}
            }},
        }
        self.write_config()

    def put(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def site_put(self, name, data):
        return self.put(f'build.nosync/web-build/site/{name}', data)

    def write_config(self):
        self.site_put('browser-default/gams.json', json.dumps(self.config).encode())

    def test_assembles_canonical_host_generated_overrides_and_notices(self):
        self.site_put('app.js', b'stale experiment copy')
        self.put('cmd/app/src/core/runtime/native.js', b'native transport must be replaced')
        self.assertEqual(web.assemble(self.root), self.output)
        plan = web.asset_plan(self.root)
        files = {path.relative_to(self.output).as_posix() for path in self.output.rglob('*') if path.is_file()}
        self.assertEqual(files, set(plan) | {'_headers', '404.html'})
        for name, source in plan.items():
            self.assertEqual((self.output / name).read_bytes(), source.read_bytes(), name)
        self.assertEqual((self.output / 'app.js').read_bytes(), b'canonical app')
        self.assertIn(b'generated core/runtime/native.js', (self.output / 'core/runtime/native.js').read_bytes())
        self.assertIn('Cache-Control: no-store', (self.output / '_headers').read_text())
        self.assertIn('X-Content-Type-Options: nosniff', (self.output / '_headers').read_text())
        self.assertEqual((self.output / '_headers').read_text(), web.HEADERS)
        for name in web.GENERATED:
            if name.endswith('.wasm'):
                self.assertIn(f'/{name}\n  Content-Type: application/wasm\n',
                              (self.output / '_headers').read_text())
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

    def test_missing_canonical_asset_or_host_dependency_license_is_rejected(self):
        for path in (self.host / 'css/reset.css',
                     self.site / 'vendor/licenses/jco/LICENSE'):
            with self.subTest(path=path):
                payload = path.read_bytes()
                path.unlink()
                try:
                    with self.assertRaisesRegex(ValueError, 'Missing required'):
                        web.assemble(self.root)
                finally:
                    path.write_bytes(payload)

    def test_stale_project_payloads_and_pin_manifests_are_not_inputs_or_outputs(self):
        for name in ('plugins/plugin.fs/v1.0.0/plugin.fs.wasm',
                     'plugins/plugin.fs/v1.0.0/LICENSE',
                     'unit-sources/view.files/v1.0.0/view.files.zip'):
            self.site_put(f'browser-default/{name}', b'stale unverified experiment payload')
            self.put(f'build.nosync/web/browser-default/{name}', b'old publication payload')
        for name in ('plugins.json', 'view-assets.json'):
            self.put(f'experiments/browser-jco/{name}', b'not valid JSON')
        web.assemble(self.root)
        self.assertEqual(
            {path.relative_to(self.output / 'browser-default').as_posix()
             for path in (self.output / 'browser-default').rglob('*')},
            {'gams.json'},
        )

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

    def test_remote_config_is_copied_byte_identically_without_rewriting_resources(self):
        # Formatting and source expressions belong to the Project, not assembly.
        payload = (json.dumps(self.config, indent=4, ensure_ascii=False) + '\n').encode()
        self.site_put('browser-default/gams.json', payload)
        web.assemble(self.root)
        self.assertEqual((self.output / 'browser-default/gams.json').read_bytes(), payload)


if __name__ == '__main__':
    unittest.main()
