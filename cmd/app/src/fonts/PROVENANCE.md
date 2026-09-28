# Bundled web-font provenance

These ten **unmodified upstream WOFF2 downloads** are served from this directory
by the GAMS Host. All binaries were freshly obtained from the indicated
official source; their SHA-256 digests identify the exact bytes now checked in.
The nine Latin subsets are Google's own `fonts.gstatic.com` WOFF2 files,
returned by the [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2)
using Chrome 132 for macOS as User-Agent and the `family=` parameters below.
A range in `family=` requests a variable font. The family-specific full SIL
Open Font License 1.1 texts were fetched from `google/fonts` commit
[`23e54b51ddffbc7713c583748e3bd86f62b1fa4a`](https://github.com/google/fonts/commit/23e54b51ddffbc7713c583748e3bd86f62b1fa4a)
and are saved in `licenses/`. Preserve every family notice and license with
these fonts. In particular, Orbitron and IBM Plex have Reserved Font Names:
we did not modify or rename the upstream subsets.

| Local WOFF2 file | Google Fonts CSS `family=` query | Official binary URL | SHA-256 | Saved license |
| --- | --- | --- | --- | --- |
| `bebas-neue-400-latin.woff2` | `Bebas+Neue` | https://fonts.gstatic.com/s/bebasneue/v16/JTUSjIg69CK48gW7PXoo9WlhyyTh89Y.woff2 | `441b026df205d28954f61b6989c7bbd228c0adff42f746a266c6a5d89134bc34` | `licenses/bebasneue.OFL.txt` |
| `ibm-plex-mono-400-latin.woff2` | `IBM+Plex+Mono:wght@400;500;600` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q131nj-o.woff2 | `c36f509c0a8f9f85f29cb44bc8701d8a9e0b14c499e77a884f789ead7093a7ac` | `licenses/ibmplexmono.OFL.txt` |
| `ibm-plex-mono-500-latin.woff2` | `IBM+Plex+Mono:wght@400;500;600` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgsAXHNk.woff2 | `a76f53ca6612e7b3828eec2311098675b7f9849ae4169a8bcef6302aec02a6c0` | `licenses/ibmplexmono.OFL.txt` |
| `ibm-plex-mono-600-latin.woff2` | `IBM+Plex+Mono:wght@400;500;600` | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgsAXHNk.woff2 | `ad4580d8cb4b5f627c2d18457656732f7f7b070f7837fbc380e08054157e6f6c` | `licenses/ibmplexmono.OFL.txt` |
| `jetbrains-mono-latin.woff2` | `JetBrains+Mono:wght@300..700` | https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwGtT0rU.woff2 | `1e06740a02a443fb7f3eeda8fcaa685a0f6c620e3f01e6666e847295469ce3ad` | `licenses/jetbrainsmono.OFL.txt` |
| `orbitron-latin.woff2` | `Orbitron:wght@400..700` | https://fonts.gstatic.com/s/orbitron/v35/yMJRMIlzdpvBhQQL_Qq7dy1biN15.woff2 | `967b3909a7d6a5cc6365e9947775060fca15efdb62bc70099aef2e7d86e10205` | `licenses/orbitron.OFL.txt` |
| `roboto-latin.woff2` | `Roboto:wght@400..700` | https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBHMdazQ.woff2 | `0a44e0bb6ba5c8537e8814c148ef7755f1bce12112361231f595ecc584a18d7a` | `licenses/roboto.OFL.txt` |
| `roboto-mono-latin.woff2` | `Roboto+Mono:wght@400..700` | https://fonts.gstatic.com/s/robotomono/v31/L0x5DF4xlVMF-BfR8bXMIjhLq3-cXbKD.woff2 | `2ed6ac9efae6d21f51b2946176a0eef79a4043d643f9ac976e66d7fc4d57803a` | `licenses/robotomono.OFL.txt` |
| `space-grotesk-latin.woff2` | `Space+Grotesk:wght@400..600` | https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2 | `a0d054c4af557de20afd6ca59f47ab353bcaec49c63ff04b6c9d39d0f8910557` | `licenses/spacegrotesk.OFL.txt` |
| `MaterialSymbolsRounded[FILL,GRAD,opsz,wght].woff2` | not from CSS API | [Google Material Symbols repository](https://raw.githubusercontent.com/google/material-design-icons/bd8cb85bd4bad964fe6918f79665bb40c3a8efef/variablefont/MaterialSymbolsRounded%5BFILL%2CGRAD%2Copsz%2Cwght%5D.woff2) | `0865c62d7fda358cd4cdb77792b758afa66fae2c4159fa3fb04a2c1d05700e9e` | `licenses/material-symbols.Apache-2.0.txt` |

Material Symbols' Apache-2.0 grant is documented by
[Google](https://developers.google.com/fonts/docs/material_symbols); its
unmodified binary and full upstream `LICENSE` come from
[`google/material-design-icons` commit `bd8cb85bd4bad964fe6918f79665bb40c3a8efef`](https://github.com/google/material-design-icons/commit/bd8cb85bd4bad964fe6918f79665bb40c3a8efef).
The repository root `LICENSE` governs **GAMS-authored** code, not these fonts.
Changing a font requires updating its source URL, checked-in binary, license
if needed, and SHA-256 in this record together.
