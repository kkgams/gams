# Jco source patches

`jco-component-wit-json.patch` adds the upstream API
`componentWitJson(componentBytes): Promise<string>` through
`@bytecodealliance/jco-transpile/wasm-tools` and the Jco API re-export.
The JSON object contains the selected `world` index and the full `resolve` graph,
including signatures, resource ownership and type aliases. It follows the bundled
wit-parser serialization format; consumers must pin the compiler version.

This is a source patch, **not an active modification of GAMS's compiler**.
The current dependency pins and downloaded compiler bytes remain unchanged.
No generic Runtime call bridge is enabled by storing this patch.

## Reapply when updating the compiler

| Ref | Action |
| --- | --- |
| A1 | Select the exact upstream source revision for the intended compiler pin. Check its working tree, then run the apply check below. Resolve conflicts explicitly; do not apply with fuzz or assume a future version is compatible. |
| A2 | Apply the patch and run `cargo test -p wasm-tools-js --lib` in that source checkout. Cargo refreshes its lockfile; review that change. The patch deliberately omits generated `Cargo.lock` context so unrelated compiler dependency versions do not prevent reapplication. Subsequent checks can use `--locked`. |
| A3 | Rebuild the upstream wasm-tools component and regenerate its JavaScript bindings/types using that checkout's documented build. Run its `wit-json.ts` tests and browser validation. Applying Rust/WIT source changes to an npm archive does not rebuild its precompiled WASM. |
| A4 | Retain original notices and pin the rebuilt artifacts/source identity and integrity checksums before selecting them in GAMS. Revalidate compiled-cache behavior and SQL/Image/Tile Detect workflows. If upstream already provides the API, verify parity and remove the carried patch instead. |

From the GAMS checkout, with `JCO_SOURCE` naming the selected upstream checkout:

```sh
patch="$PWD/cmd/web/patches/jco-component-wit-json.patch"
git -C "$JCO_SOURCE" apply --check "$patch"
git -C "$JCO_SOURCE" apply "$patch"
```

The source patch was checked against upstream
`6f77f69d9ce064ac81c72d26e2dd15bc56cb3b1f` and
`jco-transpile-v0.24.0` (`0cd19e847994a4adffe6d723cb10a733ff9b2f2c`).
Its native Rust tests pass on both revisions. It contains no generated WASM,
vendored compiler sources or package-version changes. No upstream issue/PR is
implied by this local patch.
