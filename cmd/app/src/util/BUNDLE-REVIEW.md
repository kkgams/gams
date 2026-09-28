# Ajv browser bundle: third-party redistribution evidence

`ajv.js` has SHA-256
`50d4a3f8bc2d7cd59ba7676b14d82230ceae9c9543d6a6a00a830a19b55714e3`
and begins `esm.sh - esbuild bundle(ajv@8.17.1) es2022 production`.
The source is a **bundled third-party browser library**, not GAMS-authored
code. The banner does not pin esm.sh's own build revision or exact resolved
transitive package versions; do not describe it as byte-identical to an npm
tarball. Its package's declared dependencies are
`fast-uri ^3.0.1`, `fast-deep-equal ^3.1.3`,
`require-from-string ^2.0.2`, `json-schema-traverse ^1.0.0`.
Original full license texts were recovered from the following official npm
registry tarballs and retained under `licenses/`. The SHA-256 is for the
registry **tarball**, not for the browser bundle.

| Package used for notice | Registry tarball SHA-256 | Saved text |
| --- | --- | --- |
| `ajv@8.17.1` | `f09dae78b8cc984dbf178eba92a7b19bff9e5f7c990508f3af0bf8f118770308` | `licenses/ajv.LICENSE` (MIT) |
| `fast-uri@3.0.1` | `c6a4384688609de189ca2a33c7e6d4363beed2ad4d6291ed9ca450e30cfff1c1` | `licenses/fast-uri-3.0.1.LICENSE` (BSD-style upstream notice) |
| `fast-uri@3.1.8` | `86be033b406a7737c0521edc8fe3e15c7ac0cb6b5e509478cc9539a2efaa086c` | `licenses/fast-uri-3.1.8.LICENSE` (BSD-style upstream notice) |
| `fast-deep-equal@3.1.3` | `b019a0980f27638dc3f85836b0e478f188e00d7a6e5852c0819fa86f56e47b8f` | `licenses/fast-deep-equal.LICENSE` (MIT) |
| `json-schema-traverse@1.0.0` | `023222622df29fc274bde5d3590e47aa1d4a8e3c1d6e2aba029948ed79799b21` | `licenses/json-schema-traverse.LICENSE` (MIT) |
| `require-from-string@2.0.2` | `cb694a4965908f7775a0c757f00cf4e624d193cd71d77988fbcca0f597b88d82` | `licenses/require-from-string.LICENSE` (MIT) |

Both early and current `fast-uri` v3 upstream texts are retained because
its copyright line changed within the permitted semver range. The
`fast-uri` npm package metadata says MIT, while its included `LICENSE`
contains BSD-style redistribution conditions and the Gary Court notice;
retain the **actual shipped file** and its conditions conservatively. The
exact transitive versions inside the historical esm.sh bundle are not
established; the notices above cover the identified library families without
claiming precise bundle reproducibility. If rebuilding `ajv.js`, pin its
resolved dependency versions and rebuild provenance separately.
