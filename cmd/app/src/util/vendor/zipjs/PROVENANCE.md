# zip.js browser library — development slice, not release approval

The unmodified `zip-native.js` is `index-native.min.js` from the official npm
package `@zip.js/zip.js@2.23.0`. It is a standalone ES module with the JavaScript
codec fallback embedded; no runtime CDN, separate workers, or WASM assets are
required by the Host wrapper. The wrapper disables workers and CRC verification.
Upstream package metadata declares no npm dependencies.

- Package: https://registry.npmjs.org/@zip.js/zip.js/-/zip.js-2.23.0.tgz
- Package SHA-256: `f19393bfefb5a232635ec48bc3650b846af49f30eb2f139bde540d1ce79b06cb`
- `zip-native.js` SHA-256: `dacda146a7d47a907ad31b85e6975672168416ddd02cc8200db8442f0616221e`
- `LICENSE` comes unmodified from that package (BSD-3-Clause).
- `LICENSE` SHA-256: `1b7ebc8d7889ed25491484ab2b102370742ca6c0b26650a0c62cc2269b579b84`

The package's `lib/core/streams/zlib-js/README.md` identifies the embedded JS
fallback as https://github.com/gildas-lormeau/zlib-streams-ts. Its combined
BSD-3-Clause/zlib license is retained unmodified as `zlib-streams-ts.LICENSE`,
from upstream revision `688fdc5541a7f696de1fe90253b5b3efc452bae8`:

https://raw.githubusercontent.com/gildas-lormeau/zlib-streams-ts/688fdc5541a7f696de1fe90253b5b3efc452bae8/LICENSE.md

- `zlib-streams-ts.LICENSE` SHA-256: `d7f45ed344dbb4e33229d39a0231be3077b4d75345d8a56af50fe43c098e12a5`

This identifies the fallback family and preserves its notices; it does not
establish the exact fallback source revision used to build the npm bundle.
The native variant is upstream's altered TypeScript/JavaScript port of zlib,
not GAMS-authored compression code or the original C zlib.

The existing approved Host NOTICE/evidence has **not** been refreshed. This new
browser bundle and its embedded code require redistribution review, readable
license packaging, and renewed notice/evidence approval before a Host candidate
or release is distributed. No release approval is inferred from implementation
or passing tests. Do not regenerate old evidence or weaken checks to make this
addition appear previously approved.
