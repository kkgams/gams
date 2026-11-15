import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrowserOptions, virtualPath } from './browser-options.ts';
const page = 'http://127.0.0.1:8093/browser.html';

test('browser startup defaults and Native-compatible URL names', () => {
  assert.deepEqual(parseBrowserOptions(page), {cwd:'/projects/default',config:'gams.json',modulesDir:'/projects/default/gams_modules',pluginCacheDir:'/cache/jco',source:'http://127.0.0.1:8093/browser-default/'});
  assert.deepEqual(parseBrowserOptions(page+'?project-dir=/work&config=other.json&modules-dir=/shared/units&plugin-cache-dir=.jco&source=/project&fs=opfs'), {
    cwd:'/work', config:'other.json', modulesDir:'/shared/units',pluginCacheDir:'/work/.jco',source:'http://127.0.0.1:8093/project/'
  });
  assert.equal(parseBrowserOptions(page+'?cwd=/work').cwd, '/work');
});
test('malformed, duplicate and unimplemented settings fail explicitly', () => {
  for (const query of ['config=','config=a/b.json','config=..','cwd=/a&project-dir=/b','cwd=/a&cwd=/b','modules-dir=relative','plugin-cache-dir=/','modules-dir=/work&cwd=/work','plugin-cache-dir=/same&modules-dir=/same','source=file:///x','source=https://u:p@example.com/x','source=http://example.com/x','fs=webdav','runtime=native']) {
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
