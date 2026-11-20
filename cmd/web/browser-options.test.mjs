import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserOptions, validateCorsProxy, virtualPath } from './browser-options.ts';
const page = 'http://127.0.0.1:8093/browser.html';

test('browser startup defaults and Native-compatible URL names', () => {
  assert.deepEqual(parseBrowserOptions(page), {cwd:'/projects/default',config:'gams.json',modulesDir:'/projects/default/gams_modules',pluginCacheDir:'/cache/jco',source:'http://127.0.0.1:8093/browser-default/'});
  assert.deepEqual(parseBrowserOptions(page+'?project-dir=/work&config=other.json&modules-dir=/shared/units&plugin-cache-dir=.jco&source=/project&fs=opfs'), {
    cwd:'/work', config:'other.json', modulesDir:'/shared/units',pluginCacheDir:'/work/.jco',source:'http://127.0.0.1:8093/project/'
  });
  assert.equal(parseBrowserOptions(page+'?cwd=/work').cwd, '/work');
});
test('malformed, duplicate and unimplemented settings fail explicitly', () => {
  for (const query of ['config=','config=a/b.json','config=..','cwd=/a&project-dir=/b','cwd=/a&cwd=/b','modules-dir=relative','plugin-cache-dir=/','modules-dir=/work&cwd=/work','plugin-cache-dir=/same&modules-dir=/same','source=file:///x','source=https://u:p@example.com/x','source=http://example.com/x','fs=webdav','fs=opfs-direct','runtime=native']) {
    assert.throws(()=>parseBrowserOptions(page+'?'+query), undefined, query);
  }
});
test('virtual CWD paths normalize without allowing escape or OS path interpretation', () => {
  assert.equal(virtualPath('./data/../cache','/project'),'/project/cache');
  for(const value of ['', '../escape', 'C:\\work', 'https://example.com/x', '/a\0b']) assert.throws(()=>virtualPath(value));
});

test('only implicit default Project selection supplies the same-origin first-run source',()=>{
  assert.equal(parseBrowserOptions(page).source,'http://127.0.0.1:8093/browser-default/');
  assert.equal(parseBrowserOptions(page+'?modules-dir=/shared/units').source,'http://127.0.0.1:8093/browser-default/');
  for(const query of ['config=custom.json','config=gams.json','cwd=/projects/default','project-dir=/work']) {
    assert.equal(parseBrowserOptions(page+'?'+query).source,undefined,query);
  }
  assert.equal(parseBrowserOptions(page+'?source=/mine').source,'http://127.0.0.1:8093/mine/');
});

test('CORS proxy is optional environment-only configuration preserving default bootstrap', () => {
  const defaults = parseBrowserOptions(page);
  for (const corsProxy of [undefined, null, '']) {
    assert.deepEqual(parseBrowserOptions(page, {corsProxy}), defaults);
    assert.equal(Object.hasOwn(parseBrowserOptions(page, {corsProxy}), 'corsProxy'), false);
    assert.equal(validateCorsProxy(corsProxy), undefined);
  }
  for (const corsProxy of ['http://127.0.0.1:8787/download', 'http://127.0.0.2/download', 'http://localhost/download', 'http://[::1]:8787/download', 'https://relay.test/download']) {
    assert.equal(validateCorsProxy(corsProxy), corsProxy);
    assert.deepEqual(parseBrowserOptions(page, {corsProxy}), {...defaults, corsProxy});
    assert.equal(parseBrowserOptions(page+'?cwd=/mine', {corsProxy}).source, undefined);
  }
  assert.equal(validateCorsProxy('https://relay.test'), 'https://relay.test/');
  for (const key of ['cors-proxy', 'corsProxy']) assert.throws(() => parseBrowserOptions(page+'?'+key+'=https://relay.test/download'), /Unsupported/);
});

test('CORS proxy rejects bad types, relative URLs, credentials, queries, fragments and remote HTTP', () => {
  for (const corsProxy of [false, true, 0, 42, [], {}, new URL('https://relay.test'), ' ', '/download', '//relay.test/download', 'https:relay.test', 'https:/relay.test', 'https://', 'http://remote.test/download', 'ftp://relay.test/download', 'file:///download', 'https://u:p@relay.test/download', 'https://u@relay.test/download', 'https://relay.test/download?', 'https://relay.test/download?x=1', 'https://relay.test/download#', 'https://relay.test/download#x', ' https://relay.test/download', 'https://relay.test/download\n', 'https://relay.test\\download']) {
    assert.throws(() => validateCorsProxy(corsProxy), /corsProxy/, String(corsProxy));
    assert.throws(() => parseBrowserOptions(page, {corsProxy}), /corsProxy/, String(corsProxy));
  }
});

const zip = 'https://github.com/kkgams/showcases/releases/download/v0.1.0/tilemap.zip';
const fresh = '?showcase=' + encodeURIComponent(zip);
test('showcase selects a pinned curated ZIP or reopens a saved demo', () => {
  assert.deepEqual(parseBrowserOptions(page+fresh), {showcase:{id:'tilemap',zip}});
  assert.deepEqual(parseBrowserOptions(page+'?showcase=tilemap'), {showcase:{id:'tilemap'}});
  assert.deepEqual(parseBrowserOptions(page+'?showcase=/showcases/v0.1.0/tilemap.zip'), {showcase:{id:'tilemap',zip:'http://127.0.0.1:8093/showcases/v0.1.0/tilemap.zip'}});
  for (const candidate of [zip.replace('/showcases/', '/other/'), zip.replace('v0.1.0','latest'), zip+'?x=1', zip+'#part',zip+'\n', '../tilemap','a/b','a'.repeat(65),'/showcases/v0.1.0/tilemap.zip']) {
    assert.throws(()=>parseBrowserOptions('https://gams.test/app.html?showcase='+encodeURIComponent(candidate)), /pinned/);
  }
});

test('showcase cannot target caller-chosen Project or cache paths', () => {
  for (const setting of ['project-dir=/work','cwd=/work','config=other.json','source=/demo/','modules-dir=/units','plugin-cache-dir=.jco']) {
    assert.throws(()=>parseBrowserOptions(page+fresh+'&'+setting), /cannot be combined/);
  }
  for (const setting of ['project-dir=/','cwd=/.gams-showcases','modules-dir=/a/../.gams-showcases/maps','plugin-cache-dir=/.gams-showcases']) {
    assert.throws(()=>parseBrowserOptions(page+'?'+setting), /reserved showcase storage/);
  }
});
