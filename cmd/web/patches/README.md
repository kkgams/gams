# Upstream API patch snapshot

`jco-component-wit-json.patch` is the original standalone proposal adding
`componentWitJson(bytes)` to Jco's wasm-tools API. It returns the selected `world`
index and complete `resolve` graph, including ownership and aliases.

The maintained implementation and artifact builds now belong to
[kkgams/jco](https://github.com/kkgams/jco/tree/gams), not GAMS.
GAMS downloads the pinned compiler archive in `cmd/web/dependencies.json`;
it does **not** apply this patch, compile Rust or use a sibling fork checkout.
The snapshot is retained for reference and need not change with each pin.

When updating the compiler, maintain/rebase the API change in the fork and publish
its checked artifacts there. Update GAMS's explicit release URL, integrity hash
and compiler cache identity only after that release exists. Rebuilt WASM and
regenerated bindings are required; patching precompiled npm files cannot add the
export. Follow the fork's `compiler/README.md` for build/release instructions.

The original patch was checked against upstream
`6f77f69d9ce064ac81c72d26e2dd15bc56cb3b1f` and pinned
`jco-transpile-v0.24.0` (`0cd19e847994a4adffe6d723cb10a733ff9b2f2c`).
It contains no generated WASM or package-version changes. No upstream issue/PR
is implied by the local fork or this snapshot.
