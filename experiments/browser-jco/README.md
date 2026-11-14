# Browser-native Component Model experiment

**Yes: Jco can dynamically transpile and execute components entirely in a browser today.** This isolated GAMS runtime experiment proves that compatibility layer, not a complete browser port of the desktop Host. Production runtime code is unchanged.

## Run and rebuild

From the GAMS repository root:

```sh
nix develop --command make -C experiments/browser-jco serve
# Open http://127.0.0.1:8093 (override with PORT=8094)
```

Nix uses the repository's existing lock: Node 24, Python, esbuild 0.27.2 and wasm-tools 1.248.0. No Rust target or npm installation is needed. The first build downloads three version-pinned npm **archives**, verifies their SHA-512 integrity, and extracts them under `build.nosync/browser-jco/dependencies/`; it never runs package scripts or installs a dependency tree. `dependencies.json` records the exact tested browser subset, not the full CLI dependency closure.

| Command (from repository root, inside the Nix shell) | Effect |
| --- | --- |
| `make -C experiments/browser-jco build` | Assemble static files; encode/validate WAT components and check WIT conformance. |
| `make -C experiments/browser-jco serve` | Build, then serve static files on loopback. |
| `make -C experiments/browser-jco test` | Run six native Node tests for validation, import denial and UI grant lifecycle. |
| `make -C experiments/browser-jco clean` | Guardedly delete only `build.nosync/browser-jco/`, including downloaded archives, dependencies and output. |

The existing GAMS frontend is static JavaScript without Vite or a frontend package manifest. This experiment keeps that deployment model, adding small TypeScript modules compiled by pinned esbuild. No framework, npm task runner, or production frontend integration is introduced. esbuild strips types; this build is not a TypeScript type-check.

### Try the pipeline

- **A1 — Standalone:** Load the standalone example, transpile, instantiate, then call exports. Expect `30` and `"Hello, GAMS!"`. Repeat execution measures 1,000 calls inside the worker.
- **A2 — Host import:** Load the host-logging example, transpile, and try instantiating without the grant. Expect `Missing or denied WIT import: gams:experiment/logging`. Grant logging, instantiate again, and call exports. Expect `Browser host log(30)`.
- **A3 — Upload:** Select a local component `.wasm`, transpile, inspect imports/exports and generated sizes, then instantiate. Only the optional logging interface is available; all other imports are denied. The UI's execution buttons target `add` and `greet`, not an arbitrary WIT function editor.
- **A4 — Stop:** Terminate/reset discards the worker, Jco, output and instance. A new load also resets them and clears capability grants. Each operation has a 30-second termination deadline; uploads have a 16 MiB limit. These are experiment safeguards, not production resource quotas.

`components/*.wat` are authored Component Model assembly, not pre-transpiled JS. `wasm-tools parse` encodes them into valid component binaries; `validate` and `component targets` verify their structure and WIT world. This avoids a language SDK for a tiny deterministic test. Both implement canonical UTF-8 string lifting/lowering, allocation, memory growth and post-return reclamation. The second world imports `logging.log(value: s32)`; `add` logs its result.

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
| `runtime.ts` | Check component header/size and instantiate with explicit import grants. |
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

Jco loads four compiler core Wasm assets, totaling **5,685,103 bytes**, alongside a **670,303-byte** unminified worker bundle in this build. The [backend uses literal relative URLs](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco-transpile/src/component.ts#L13-L38) and browser `WebAssembly.compileStreaming(fetch(url))`. Serve `.wasm` with `application/wasm`.

esbuild aliases only the public browser entry and its browser dependency subset. It preserves `import.meta.url`; the worker and four core modules are placed together under `site/vendor/` so `../vendor/<asset>` resolves correctly. No generated JavaScript is rewritten. The conditional Node `node:fs/promises` branch remains external and is never executed in a browser. Do not import the Node-oriented Jco root/default CLI implementation or pull in its native minifier/compiler dependencies.

Vite was not used/tested here. Upstream has [Vite browser bundling tests](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco-transpile/test/browser/component-bundling.ts#L15-L67); a different bundler must still preserve/copy the compiler assets and select browser shim exports. Worker bare imports cannot rely on a document import map, hence the bundled worker.

### F3 — Async instantiation plus a Blob module solves filesystem-free loading

These are complementary, not competing, approaches. Jco's [async instantiation mode](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/docs/src/transpiling.md#L291-L338) generates an `instantiate(getCoreModule, imports)` export. The experiment imports its single generated JS module from a Blob URL, then supplies an exact-filename lookup that compiles the in-memory core bytes. It does not fetch generated files or rely on Blob-relative paths. Upstream uses a [similar Blob fixture](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/jco-transpile/test/fixtures/browser/transpile.js#L58-L92).

`base64Cutoff: 0` exposes extracted Wasm rather than hiding small cores in JS. Imports are supplied as objects, so generated ES imports need no resolver for the tested output. Blob URLs are revoked after instantiation; reset terminates the worker to release its module graph, instance and compiler. Arbitrary multi-JS generated graphs are not implemented by this loader.

Required APIs: WebAssembly compilation/instantiation, module workers, dynamic ES import, Blob URLs, Fetch, File/ArrayBuffer, TextEncoder/Decoder, Web Crypto for compiler shims, and performance timing. The page CSP permits same-origin assets, `blob:` scripts and `wasm-unsafe-eval`, without general `unsafe-eval`. Tested without cross-origin isolation or SharedArrayBuffer. CSP prohibiting Blob modules would require a different module-delivery strategy.

### F4 — Browser WASI is not native WASI

The **compiler** gets Jco's standard browser WASI shims for its internal operation. The **loaded component** gets no automatic WASI shim: only the explicitly granted logging interface. Filesystem paths, sockets or network imports do not become available just because Jco recognizes them.

Upstream browser shims cover subsets of CLI/streams, clocks, random, configured virtual filesystems and Fetch HTTP; raw TCP/UDP, independent DNS, arbitrary HTTP listening and synchronous blocking require different adapters or are unavailable. See the [capability table](https://github.com/bytecodealliance/jco/blob/7d36424c577bdc6e913ff22ef3bc61b42cde0253/packages/preview2-shim/README.md#L13-L64).

### F5 — Component feature coverage must be tested per workload

This experiment proves `s32`, UTF-8 strings, exports, imported interfaces and canonical memory/realloc/post-return. It does not prove every GAMS plugin, resource lifecycle, WASI operation, threading or Preview 3 feature.

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
- **R1 — Startup/expansion cost:** This tiny input produces over 100 KB of JS and needs about 6.36 MB of uncompressed compiler Wasm/worker JS. Repeated runtime compilation on every load is wasteful; large GAMS plugins and low-end devices need separate measurement. These tiny timings cannot predict their cost.
- **R2 — Missing Host facilities:** GAMS filesystem/configuration, resources, plugin interfaces and async services need real browser adapters and compatibility tests. Native Wasmtime behavior, operating-system access and plugin.js/plugin.lua compatibility are not established by this experiment.
- **R3 — Security/lifecycle:** Keep grants explicit and scoped to each instance; the default import set remains empty. Workers allow termination, not hard Wasm memory limits or a separate-origin security sandbox. Production needs isolation, quotas, trap/disposal handling, dependency integrity/CSP policy and hostile-component testing.
- **A5 — Optional cache:** IndexedDB can store the generated filename/byte tuples and import/export metadata. Key by SHA-256(component bytes), exact Jco/backend versions and generation options; validate cached provenance, invalidate on any change, and fall back to fresh transpilation. Do not persist Blob URLs. No cache is implemented or benchmarked here.
- **A6 — Future capabilities:** Add named WIT interfaces with per-instance grants: bounded diagnostics; scoped state handles; storage namespaces; allowlisted Fetch operations; controlled service calls; and explicit component-to-component routing. Asynchronous browser services need a deliberate async/JSPI or message-protocol contract, not implicit permission or synchronous OS emulation. Only logging is implemented.

**Conclusion:** Browser-native dynamic components are demonstrated, not merely plausible. A production GAMS browser application is realistic, but requires host adapters, workload compatibility, caching, resource controls and cross-browser validation—not just replacing Wasmtime with this loader.

## Attribution

Jco, its transpiler and Preview 2 shims use Apache-2.0 WITH LLVM-exception. Original license texts and upstream metadata are copied beside served assets under `vendor/licenses/`. Jco 1.42.0's npm archive omits a root LICENSE; `LICENSE-JCO` is the exact upstream license from commit `7d36424c577bdc6e913ff22ef3bc61b42cde0253` (identical SHA-256 to the transpiler archive's LICENSE). GAMS-authored experiment code follows the repository's Apache-2.0 license. Nothing is published by these commands.
