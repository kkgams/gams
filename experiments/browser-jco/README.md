# Browser-native Component Model experiment

**Yes: Jco can dynamically transpile and execute components entirely in a browser today.** This isolated GAMS runtime experiment proves that compatibility layer, not a complete browser port of the desktop Host. Production runtime code is unchanged.

## Run and rebuild

From the GAMS repository root:

```sh
nix develop --command make -C experiments/browser-jco serve
# Component diagnostics: http://127.0.0.1:8093
# Configured browser Host: http://127.0.0.1:8093/browser.html
# Fixed Files View: http://127.0.0.1:8093/files.html (override with PORT=8094)
```

The [configured browser Host](BROWSER.md) serves the complete canonical frontend and opens an explicitly selected `gams.json` Project, with URL startup settings, browser-side Unit installation and persistent Jco caches. Bare `/browser.html` now initializes a minimal same-origin Files Project when its default config is missing; existing or explicitly selected configs are not replaced. The fixed Files/component pages remain available separately.

Nix uses the repository's existing lock: Node 24, Python, esbuild 0.27.2 and wasm-tools 1.248.0. No Rust target or npm installation is needed. The first build downloads three version-pinned npm **archives**, verifies their SHA-512 integrity, and extracts them under `build.nosync/browser-jco/dependencies/`; it never runs package scripts or installs a dependency tree. `dependencies.json` records the exact tested browser subset, not the full CLI dependency closure. The build also downloads unchanged released plugins and their original license assets from pinned GitHub tags in `plugins.json`, verifying every asset against its recorded SHA-256 (checked against the published SHA256SUMS). The [real Files View shell](FILES.md) additionally pins released UI Units/theme in `view-assets.json`, retaining their original license assets and using canonical Host Runtime/helpers from this checkout. No sibling repository checkout is needed.

| Command (from repository root, inside the Nix shell) | Effect |
| --- | --- |
| `make -C experiments/browser-jco build` | Assemble static files; encode/validate WAT components and check WIT conformance. |
| `make -C experiments/browser-jco serve` | Build, then serve static files on loopback. |
| `make -C experiments/browser-jco test` | Run native Node tests and static HTTP server checks. |
| `make -C experiments/browser-jco clean` | Guardedly delete only `build.nosync/browser-jco/`, including downloaded archives, dependencies and output. |

The existing GAMS frontend is static JavaScript without Vite or a frontend package manifest. This experiment keeps that deployment model, adding small TypeScript modules compiled by pinned esbuild. No framework or npm task runner is introduced. The root-hosted app assembled by `make web` uses this same browser Host implementation; see [web deployment](../../docs/web-deployment.md). esbuild strips types; this build is not a TypeScript type-check.

### Try the pipeline

- **A1 — Standalone:** Load the standalone example, transpile, instantiate, then call exports. Expect `30` and `"Hello, GAMS!"`. Repeat execution measures 1,000 calls inside the worker.
- **A2 — Host import:** Load the host-logging example, transpile, and try instantiating without the grant. Expect `Missing or denied WIT import: gams:experiment/logging`. Grant logging, instantiate again, and call exports. Expect `Browser host log(30)`.
- **A3 — Upload:** Select a local component `.wasm`, transpile, inspect imports/exports and generated sizes, then instantiate. Only explicitly granted logging or filesystem interfaces are available; other imports are denied. Execution buttons cover the toy functions and the two real plugins, not an arbitrary WIT function editor.
- **A4 — Stop:** **Checkpoint and restart worker** waits for guest shutdown and storage disposal before terminating. Loading another component does the same and clears grants. A failed shutdown retains the worker. A 30-second timeout blocks further normal actions without automatically terminating; the separate **Force stop** button can discard in-flight changes, which may be lost or partially persisted. Uploads have a 16 MiB limit. These are experiment safeguards, not production resource quotas.

`components/*.wat` are authored Component Model assembly, not pre-transpiled JS. `wasm-tools parse` encodes them into valid component binaries; `validate` and `component targets` verify their structure and WIT world. This avoids a language SDK for a tiny deterministic test. Both implement canonical UTF-8 string lifting/lowering, allocation, memory growth and post-return reclamation. The second world imports `logging.log(value: s32)`; `add` logs its result.

## Real released plugins

- **A7 — Random:** Select `plugin.random v0.2.2`, load, transpile, instantiate with **no grants**, then click **Check random seed replay**. Its binary has no imports. The checks set/reset seed `123n`, compare two 16-byte sequences, verify generation `0 → 2 → 3`, and read a `u64`. Full versioned interface exports and camelCase methods are called directly; worker RPC also accepts an `interface` key for namespaced invocation. `u64` values remain BigInt across the ABI and are displayed as decimal strings without precision loss.
- **A8 — Filesystem:** Select `plugin.fs v0.2.3`, load/transpile and first try instantiating without grants: it must fail. Enable **Grant /project filesystem**, leave **Storage** on **Disposable memory**, instantiate, then click **Check filesystem operations and boundaries**. Fourteen checks cover UTF-8/binary reads and writes, directory creation/listing, byte-size stat, rename/deletion, missing paths, traversal and outside-preopen rejection, cleanup and an unchanged root listing. Checks refuse to overwrite an existing check directory.

Both plugins are served as their original released component bytes, including embedded notices. They are not rebuilt, patched, or pre-transpiled. Their license assets are served under `vendor/licenses/plugin.random/` and `vendor/licenses/plugin.fs/`.

The replacement is **below** the real filesystem plugin:

```text
Real plugin.fs component → Jco canonical bindings / resource handles
                        → wasi:filesystem/{types,preopens}
                        → Preview 2 InMemoryFilesystemAdapter
                        → a fresh, explicitly granted /project directory
```

`createFilesystem()` creates isolated namespaces, not the shim's global preopens used by Jco's compiler. Memory mode starts each instantiation with a new empty tree; OPFS mode reloads its dedicated persistent directory. Neither grants native disk, IndexedDB or network access. Loading/restarting clears grants and returns the selector to memory mode without deleting OPFS data. Grant or backend changes disable execution until reinstantiation and cannot race a pending operation. Neither mode is complete GAMS integration.

The released fs binary imports WASI filesystem **0.2.6** and wall-clock's datetime **type**, although its source world starts from 0.2.0. With the pinned Jco, generated imports are exactly `wasi:filesystem/preopens` and `wasi:filesystem/types`: unversioned keys. The type-only wall-clock import disappears; no clock capability is needed. The host allowlist supplies only these generated filesystem keys when granted. This proves the resource/borrow paths actually exercised by this plugin, not every WASI/resource feature.

### Real-browser results

Both plugins passed in Chrome 145 on macOS with the same Jco/backend/shim pins as the original experiment. Single cached local runs, not statistical benchmarks:

| Metric | plugin.random v0.2.2 | plugin.fs v0.2.3 |
| --- | ---: | ---: |
| Original component bytes | 146,319 | 55,491 |
| Browser transpilation | 52.9 ms | 58.8 ms |
| Instantiation | 11.0 ms | 6.8 ms |
| Plugin checks | 5.9 ms | 27.1 ms |
| Generated JS | 108,125 bytes | 340,745 bytes |
| Generated core Wasm total | 13,181 bytes (2 files) | 25,710 bytes (4 files) |
| Total output | 121,306 bytes | 366,455 bytes |

Seed `123` produced bytes `[43,65,222,98,212,155,220,180,124,183,111,240,233,60,2,250]` on both runs, then `15857969311440292840` from `getRandomU64()`. Filesystem text `Hello, 世界! 🌍\n` round-tripped with stat size `20n`; missing paths returned `no-entry`, traversal returned `not-permitted`, and outside-preopen access returned `path is not under a WASI preopen`. Timestamp fields are zero in this memory backend.

The released-plugin milestone passed `nix develop --command make -C experiments/browser-jco clean build test` from the GAMS root, redownloading pinned assets and running its then-current 16 native tests. Additional real-worker RPC checks verified denied instantiation without a filesystem grant, namespaced write/read, rejection of inherited `toString`, and loss of a marker file after reinstantiation. Native mock-based tests only check assertion/dispatch/error handling; the success evidence above comes from executing the actual plugin components in Chrome. Other browsers and other GAMS plugins remain unverified; the additional OPFS validation is below.

## Persistent OPFS mode

OPFS uses the same unchanged released `plugin.fs` and WASI imports. Only the backing adapter changes to pinned `OpfsFilesystemAdapter` / `loadOpfsCapability`. This is a synchronous **memory mirror with asynchronous persistence**, not a `FileSystemSyncAccessHandle` implementation. The entire directory is loaded into memory and reconciled back to storage, including removal of entries absent from the mirror.

- **A9 — Open:** Load/transpile `plugin.fs`, check **Grant /project filesystem**, select **Persistent OPFS experiment**, then instantiate. The only backing directory is `gams-browser-jco-experiment-v1` under this origin's OPFS root, exposed as `/project`. No picked folder or origin root is granted.
- **A10 — Persist:** Click **Write fixture**. Success means the UTF-8/binary fixture was checked and its persistence checkpoint completed. Restart the worker or reload the page; grant OPFS again and click **Verify fixture**. Write refuses an existing fixture rather than overwriting it.
- **A11 — Rename:** Click **Rename fixture**, reopen in a new worker/page, and verify the renamed layout and contents.
- **A12 — Delete:** Click **Delete fixture**, reopen, then **Verify deletion**. Deletion validates known fixture names/content before removing only its files/directory. It does not clear the whole backing directory.

Every successful worker operation awaits a checkpoint before replying; **Flush filesystem** also explicitly requests one. Normal reinstantiate, retranspile, load and restart stop the guest, await storage disposal first. The worker serializes requests so async checkpoints cannot overlap lifecycle changes. Adapter automatic-flush failures are observed and retained: a later success must not conceal an earlier unreported persistence failure. On such a failure, normal close fails without claiming success; inspect diagnostics before explicitly forcing a stop. Do not close/reload during an operation. Browser unload cannot await a shutdown protocol.

The shim reserves `.__wasi_symlinks__.json` for metadata and would otherwise hide/delete an ordinary guest file with that name despite a successful flush. An OPFS-only descriptor guard rejects that path segment with WIT `not-permitted` before any mutation, including child paths and rename/link destinations. It binds descriptor methods to their original receivers and unwraps cross-descriptor arguments, preserving resource/private-field behavior. The plugin binary and shim source are unchanged.

Only one instance is supported. No Host writer lock or lock file is used; concurrent/external writes can be lost when a stale whole-tree mirror checkpoints. Do not open multiple instances against this store. OPFS must be available; memory mode remains independent. No COOP/COEP, SharedArrayBuffer, JSPI or extra I/O worker is required by this mirror-based mode.

### OPFS verification and limitations

Real Chrome 145 tests passed with cross-origin isolation **disabled**:

| Test | Observed result |
| --- | --- |
| UTF-8 text + six binary bytes | Read back through plugin.fs and independently from OPFS file handles after checkpoint. |
| Graceful worker restart | Fixture preserved; grants cleared; explicit regrant reopened it. |
| Page reload | Original contents and byte sizes preserved. |
| Rename → reload | New name/content preserved; original name absent. |
| Delete → reload | Exact WIT `no-entry` for the fixture directory. |
| Existing filesystem suite | All 14 checks passed with OPFS, including traversal/outside-preopen rejection. |
| Directory boundary | A separately created sibling file under the origin root was unchanged, then removed by its creating test. |
| Injected `createWritable` failure | Write and shutdown returned the quota-style failure, not success; no unhandled rejection; explicit termination released the session. |
| Reserved shim filename | Root/nested writes and rename-to-sidecar returned `not-permitted`; the original ordinary file stayed unchanged. |

A local cached run observed OPFS instantiation at 32.3 ms and fixture write/checkpoint at 26.6 ms (4.9 ms checkpoint portion). These are observations, not throughput benchmarks. The native Node tests cover fixture assertions, refusal to delete unfamiliar content, reserved-name guards/private-field forwarding, and UI close/failure/timeout behavior; they do not substitute for browser persistence tests.

- **R4 — Mirror scope:** Use only this isolated experiment directory. Whole-tree rewriting is unsuitable for arbitrary user folders, large asset trees or uncoordinated external writers. Concurrency is out of scope; no writer coordination is implemented.
- **R5 — Persistence semantics:** Checkpoints acknowledge completion of the browser write/close APIs, not filesystem transactions, rollback snapshots, crash consistency or physical-media fsync. A forced stop can leave partial changes. Browser quota, eviction, site-data clearing and private browsing still affect storage; persistent-storage permission is not requested here.
- **R6 — Origin and cleanup:** Storage belongs to the exact browser origin, including port. Keep `127.0.0.1:8093` to reopen these fixtures; changing host/port creates a different store. `make clean` removes checkout build output only and does not delete browser data. The fixture buttons are the bounded test cleanup; no whole-origin delete operation is provided.

## Architecture

```text
Static HTTP files → UI → module worker
                          ├─ Jco browser API + compiler core Wasm
Component bytes ──────────┤
                          ├─ transpile → in-memory JS / core Wasm tuples
                          ├─ explicit import grant check
                          ├─ Blob JS import → instantiate(core compiler, imports)
                          └─ call export → result / host-log messages → UI
```

| File | Responsibility |
| --- | --- |
| `ui.ts` | Load/upload, worker RPC, status, diagnostics and measurements. |
| `transpiler-worker.ts` | Initialize Jco; transpile, instantiate and invoke; retain output in memory. |
| `runtime.ts` | Check component header/size and instantiate with an explicit import map. |
| `capabilities.ts` | Construct granted imports, memory/OPFS sessions, checkpoints, disposal. |
| `opfs-checks.ts` | Bounded persistent fixture lifecycle through the real plugin.fs exports. |
| `opfs-paths.ts` | Reject guest paths conflicting with the shim's reserved metadata filename. |
| `plugin-checks.ts` | Invoke real plugin interfaces and assert results/boundaries. |
| `plugins.json` | Pin released plugin binaries and original license assets by tag/SHA-256. |
| `components/` | Two source components and their WIT worlds. |
| `build.py`, `Makefile` | Static assembly, validated component encoding, serving and clean. |

The server is Python's standard static HTTP server, with no transpilation endpoint or Jco subprocess. Build-time esbuild bundles the **compiler itself**; it never transpiles either sample component. Generated component bindings exist only after clicking Transpile in the browser. All runtime dependencies are served locally; no CDN or backend computation is required.

## Verified API and integration findings

Source links below refer to upstream commit `7d36424c577bdc6e913ff22ef3bc61b42cde0253`; package behavior was separately checked against the downloaded published archives and actual Chrome execution.

### F1 — Public browser entry point works

Tested `@bytecodealliance/jco` **1.42.0**, `@bytecodealliance/jco-transpile` **0.24.0**, and `@bytecodealliance/preview2-shim` **0.31.1**. The published Jco exports map contains `./component → ./dist/browser.js`, and those files are present. No underlying-module bypass or Jco patch was necessary.

The [browser wrapper](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco/src/browser.ts#L1-L36) provides async `generate()` and its backward-compatible alias `transpile()`, waiting for the backend's live `$init` promise. Its actual contract differs from the illustrative CLI-style API:

```ts
const output = await transpile(bytes, {
  name: 'component',
  instantiation: { tag: 'async' },
  noTypescript: true,
  noNodejsCompat: true,
  base64Cutoff: 0,
});
// output.files: Array<[string, Uint8Array]>
// output.imports: string[]
// output.exports: Array<[string, 'function' | 'instance']>
```

The worker separately awaits the lower-level `$init` to measure initialization before any component is transpiled. That backend's `generate()` itself is synchronous after initialization. This API is the bindgen layer, not the full CLI optimization/minification pipeline; see the [options definition](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/crates/js-component-bindgen-component/wit/js-component-bindgen.wit#L82-L156).

### F2 — Compiler assets and bundling need explicit handling

Jco loads four compiler core Wasm assets, totaling **5,685,103 bytes**, alongside an **approximately 691 KB** unminified worker bundle in this build. The [backend uses literal relative URLs](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco-transpile/src/component.ts#L13-L38) and browser `WebAssembly.compileStreaming(fetch(url))`. Serve `.wasm` with `application/wasm`.

esbuild aliases only the public browser entry and its browser dependency subset. It preserves `import.meta.url`; the worker and four core modules are placed together under `site/vendor/` so `../vendor/<asset>` resolves correctly. No generated JavaScript is rewritten. The conditional Node `node:fs/promises` branch remains external and is never executed in a browser. Do not import the Node-oriented Jco root/default CLI implementation or pull in its native minifier/compiler dependencies.

Vite was not used/tested here. Upstream has [Vite browser bundling tests](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco-transpile/test/browser/component-bundling.ts#L15-L67); a different bundler must still preserve/copy the compiler assets and select browser shim exports. Worker bare imports cannot rely on a document import map, hence the bundled worker.

### F3 — Async instantiation plus a Blob module solves filesystem-free loading

These are complementary, not competing, approaches. Jco's [async instantiation mode](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/docs/src/transpiling.md#L291-L338) generates an `instantiate(getCoreModule, imports)` export. The experiment imports its single generated JS module from a Blob URL, then supplies an exact-filename lookup that compiles the in-memory core bytes. It does not fetch generated files or rely on Blob-relative paths. Upstream uses a [similar Blob fixture](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco-transpile/test/fixtures/browser/transpile.js#L58-L92).

`base64Cutoff: 0` exposes extracted Wasm rather than hiding small cores in JS. Imports are supplied as objects, so generated ES imports need no resolver for the tested output. Blob URLs are revoked after instantiation; reset terminates the worker to release its module graph, instance and compiler. Arbitrary multi-JS generated graphs are not implemented by this loader.

Required APIs: WebAssembly compilation/instantiation, module workers, dynamic ES import, Blob URLs, Fetch, File/ArrayBuffer, TextEncoder/Decoder, Web Crypto for compiler shims, and performance timing. The page CSP permits same-origin assets, `blob:` scripts and `wasm-unsafe-eval`, without general `unsafe-eval`. Tested without cross-origin isolation or SharedArrayBuffer. CSP prohibiting Blob modules would require a different module-delivery strategy.

### F4 — Browser WASI is not native WASI

The **compiler** gets Jco's standard browser WASI shims for its internal operation. The **loaded component** gets no automatic WASI shim: only explicitly granted logging and/or isolated filesystem interfaces backed by memory or OPFS. Filesystem paths, sockets or network imports do not become available just because Jco recognizes them.

Upstream browser shims cover subsets of CLI/streams, clocks, random, configured virtual filesystems and Fetch HTTP; raw TCP/UDP, independent DNS, arbitrary HTTP listening and synchronous blocking require different adapters or are unavailable. See the [capability table](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/preview2-shim/README.md#L13-L64).

### F5 — Component feature coverage must be tested per workload

This experiment proves `s32`, UTF-8 strings, exports, imported interfaces and canonical memory/realloc/post-return, plus the real plugins' `u64`/byte-array/state behavior and filesystem descriptor/directory-stream resource paths. It does not prove every GAMS plugin, resource lifecycle, WASI operation, threading or Preview 3 feature.

Async **instantiation** does not make guest execution asynchronous. JSPI bridges selected asynchronous imports; Preview 3 streams/futures are a separate feature. See the [explicit distinction](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/crates/js-component-bindgen/src/lib.rs#L563-L577). Neither was exercised here. Jco's validator [warns that accepting feature flags does not establish correct transpiled execution](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/crates/js-component-bindgen/src/lib.rs#L293-L316).

Resources have [JS ownership/disposal representations](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/docs/src/advanced/wit-type-representations.md#L556-L581), but specific flat borrowed-resource [lowering](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/crates/js-component-bindgen/src/intrinsics/lower.rs#L1108-L1118) and [lifting](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/crates/js-component-bindgen/src/intrinsics/lift.rs#L1414-L1424) paths explicitly remain unsupported. Do not infer broad resource support from these samples.

## Browser measurements and validation

Tested in real Chrome **145.0.0.0** on macOS; other engines and mobile were not tested. These are individual local observations with cached static assets, not statistically controlled benchmarks or cold-network estimates.

| Metric | Standalone | Imported logging |
| --- | ---: | ---: |
| Component bytes | 656 | 810 |
| Component fetch/read | 4.8 ms | 4.0 ms |
| Jco worker initialization | 42.2 ms | 45.8 ms |
| Browser transpilation | 283.3 ms | 245.6 ms |
| Instantiation, including Blob import/core compile | 10.7 ms | 9.1 ms |
| First `add` execution | 2.4 ms | 3.6 ms |
| `greet` execution | 1.5 ms | 2.3 ms |
| 1,000 repeated adds | 17.0 ms total / 0.017 ms mean | Not recorded |
| Generated JS | 102,886 bytes | 115,846 bytes |
| Extracted core Wasm | 458 bytes | 487 bytes |
| Total generated output | 103,344 bytes | 116,333 bytes |

Worker timings use `performance.now()` around each operation and exclude UI-message round trips. Repeated-call timing includes loop/canonical binding overhead; logging-component repetition also includes host message overhead. Initialization measures module loading and compiler initialization, not worker startup before its first statement. The UI reports Chromium's optional **main-thread JS heap** only; it does not measure worker/Wasm memory, so no total-memory claim is made.

The final standalone test loaded bytes/initialized Jco, then **stopped the static server before transpiling, instantiating or calling exports**. All still succeeded, including 1,000 calls returning 30. The host component separately returned both expected results and delivered a JavaScript `log(30)` callback. Error cases tested in Chrome: denied logging grant, a core-only Wasm upload, and malformed component sections. A fresh load/reset then returned to successful execution. The native tests supplement—not replace—these real-browser checks.

## Feasibility and next boundaries

- **D1 — Viable now:** Use Jco as a browser Component Model compatibility layer for dynamically loaded components with explicitly implemented host contracts. The compiler works inside a worker without a backend, filesystem or Jco changes.
- **R1 — Startup/expansion cost:** The toy input produces over 100 KB of JS and the current experiment needs about 6.36 MB of uncompressed compiler Wasm/worker JS. Repeated runtime compilation on every load is wasteful; large GAMS plugins and low-end devices need separate measurement. These tiny timings cannot predict their cost.
- **R2 — Missing Host facilities:** GAMS filesystem/configuration, resources, plugin interfaces and async services need real browser adapters and compatibility tests. Native Wasmtime behavior, operating-system access and plugin.js/plugin.lua compatibility are not established by this experiment.
- **R3 — Security/lifecycle:** Keep grants explicit and scoped to each instance; the default import set remains empty. Workers allow termination, not hard Wasm memory limits or a separate-origin security sandbox. Production needs isolation, quotas, trap/disposal handling, dependency integrity/CSP policy and hostile-component testing.
- **A5 — Optional cache:** IndexedDB can store the generated filename/byte tuples and import/export metadata. Key by SHA-256(component bytes), exact Jco/backend versions and generation options; validate cached provenance, invalidate on any change, and fall back to fresh transpilation. Do not persist Blob URLs. No cache is implemented or benchmarked here.
- **A6 — Future capabilities:** Add named WIT interfaces with per-instance grants: bounded diagnostics; scoped state handles; storage namespaces; allowlisted Fetch operations; controlled service calls; and explicit component-to-component routing. Asynchronous browser services need a deliberate async/JSPI or message-protocol contract, not implicit permission or synchronous OS emulation. Logging, disposable memory and isolated mirror-based OPFS persistence are implemented; other host services and browser-runtime storage configuration contracts are not.

**Conclusion:** Browser-native dynamic components are demonstrated, not merely plausible. A production GAMS browser application is realistic, but requires host adapters, workload compatibility, caching, resource controls and cross-browser validation—not just replacing Wasmtime with this loader.

## Attribution

Jco, its transpiler and Preview 2 shims use Apache-2.0 WITH LLVM-exception. Original license texts and upstream metadata are copied beside served assets under `vendor/licenses/`. Jco 1.42.0's npm archive omits a root LICENSE; `LICENSE-JCO` is the exact upstream license from commit `7d36424c577bdc6e913ff22ef3bc61b42cde0253` (identical SHA-256 to the transpiler archive's LICENSE). GAMS-authored experiment code follows the repository's Apache-2.0 license. Nothing is published by these commands.
