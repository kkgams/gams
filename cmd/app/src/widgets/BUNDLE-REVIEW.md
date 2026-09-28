# markdown-it browser bundle: third-party redistribution evidence

`markdown-it.js` is a browser ES-module adaptation of the upstream
`markdown-it@14.1.0/dist/markdown-it.js` UMD bundle, not GAMS-authored code.
The checked-in JS has SHA-256
`2eb56368f6bdd49231bab3ef495fce8e8205ce4ffbd8fb1be4fc3bbe681140ea`.
The upstream `markdown-it@14.1.0` npm tarball SHA-256 is
`7c4fab4d4d39fe98206a7fbbed4b1e3578f2b70b6b69d309413e33eec140e19f`;
its `LICENSE` matches our existing `markdown-it.LICENSE` SHA-256
`792c48c5a849a15fdf9e37e8bcf9e6d1dd13b32b46c642a748a0a46a9919d473`.
The bundle contains mdurl, uc.micro, entities, linkify-it and punycode.
Full texts recovered from the npm registry tarballs below are retained
under `licenses/`. The historical minified/transformed bundle does not
record exact transitive package versions; these are the minimum compatible
versions from upstream's `package.json`, not a claim of byte-for-byte
reproducibility. The current compatible package versions were checked too;
their license bytes match those retained here.

| Dependency used for notice | Official npm tarball SHA-256 | Full upstream text |
| --- | --- | --- |
| `mdurl@2.0.0` | `8e0ccb320730dad17981e2a4cc97f34f072366442d000de97070fd1ea21321b5` | `licenses/mdurl.LICENSE` (MIT) |
| `uc.micro@2.1.0` | `a31660c690ddac370fe4b17fe6a3a73b8df094f99194ac90d0668d797dabf69b` | `licenses/uc.micro.LICENSE` (MIT) |
| `entities@4.4.0` | `259d977a75c6af00edcc2f69fd4a180d14e0cc6186c0817bce027c92b6995ba4` | `licenses/entities.LICENSE` (BSD-2-Clause) |
| `linkify-it@5.0.0` | `6144c5a52d26c2bb917bc320d707cf4a41c94514ce856b8b1baf934d3fb27aa9` | `licenses/linkify-it.LICENSE` (MIT) |
| `punycode.js@2.3.1` | `8768d89aa6359164220014ba575e1464e3ddff11bedff1cc268e39a21f7324a8` | `licenses/punycode.js.LICENSE` (MIT) |

The browser bundle also retains a Joyent/Node attribution and permission
notice in its own source. It is additionally saved (comment markers removed,
terms unchanged) as `licenses/joyent-node.LICENSE` for readable app ZIPs.
`argparse` appears in markdown-it's **package**
dependency list but is a command-line parser and its code was not identified
in this browser bundle; do not label it as bundled without evidence.
