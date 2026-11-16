---
title: Browser app deployment
status: reference
---

# Deploy the browser app

The browser app is a separate, root-hosted Cloudflare Pages site. The existing GitHub Pages promo and documentation deployment stays unchanged. Both use this repository and the `release` branch; no second source repository is required.

Use the site's root URL, not a subfolder. Released Views import Host modules from `/core/`, `/util/` and `/widgets/`. The browser Host supports FS, layout, Tile Detect, the tested random interfaces, selected Image resource operations and SQL connection/statement/error operations. See `cmd/web/README.md` for exact interfaces and limits. Arbitrary plugin interfaces, component linking and Native shell/process integrations are not supported; select Projects accordingly.

## Build and preview

From this checkout:

```sh
nix develop .#web --command make test-web web
nix develop .#web --command make serve-web
# http://127.0.0.1:8093/
```

The pinned web shell supplies Python, Node 24, Make, esbuild, wasm-tools and Wrangler. It does not require Rust or the desktop GTK/WebKit SDK.

Production sources, dependency pins and the static server live in `cmd/web/`; its `README.md` describes browser Host usage and compatibility. `make web`, `make test-web` and `make serve-web` use that production implementation; `make test-web` covers its Node tests, static-server checks and web assembly/date tests, not diagnostic tests.

`make web` first stages production assets in `build.nosync/web-build/site/`, caching compiler dependencies under `build.nosync/web-build/`, then assembles `build.nosync/web/`, with the configured Host at `index.html`, canonical Host assets, Jco, the default Files Project configuration and original Host/compiler dependency licenses. The default Project's pinned plugins, Views and UI Services download directly into browser `gams_modules/`, retaining the releases' companion files and licenses; they are not mirrored into `unit-sources/` or `plugins/` folders in the Project. Diagnostic experiment pages and toy components are not published. `make clean` removes staging, compiler caches, published output and disposable `build.nosync/web-tools/` deployment logs/caches, not browser data.

Set `GAMS_CORS_PROXY` in the build environment to use a public download relay. Unset/empty leaves direct downloads; fresh default Project startup then fails if GitHub denies browser CORS. Previously installed Units remain usable from OPFS caches. Its value is emitted into public browser settings; no endpoint is hardcoded in GAMS source. Rebuild and reload after changing it.

## Set up Cloudflare Pages

Use a **Direct Upload** Pages project: GitHub Actions will build using pinned Nix and upload the finished files. Do not also connect Cloudflare's Git builds to this project; that would create a second deployment pipeline and would not read GitHub Actions repository variables. Workers & Pages hosts this app as **Pages**, separately from the download relay Worker.

Authenticate the pinned CLI and create a project once, replacing the placeholder name:

```sh
nix develop .#web --command wrangler login
nix develop .#web --command wrangler pages project create <project-name> --production-branch release
```

Choose the intended Cloudflare account. OAuth login credentials are user-managed, not build output. The production branch must be `release`, so subsequent uploads update the stable production URL rather than only preview deployments.

In GitHub repository **Settings → Secrets and variables → Actions**, configure:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `GAMS_CORS_PROXY` | Your public relay endpoint, including `/download`. |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | The account containing the Pages project. |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | The project name just created. |
| Secret | `CLOUDFLARE_API_TOKEN` | A token scoped to that account with **Cloudflare Pages: Edit** permission. |

The workflow reads these explicitly; merely defining a GitHub variable does not put it in a build's environment. The token is exposed only to the deployment step, never to PR builds or the public app output. Do not commit credentials.

`.github/workflows/web.yml` tests/builds pull requests without deployment. Pushes to `release`, or a manual run selecting `release`, test/build and upload to Cloudflare. Required production settings must be configured before pushing this workflow. The existing GitHub Pages workflow continues to publish promo/docs independently.

## Allow the app to use the relay

Add the **exact stable app origin** (`https://<project-name>.pages.dev`) to the relay's `CORS_PROXY_ALLOWED_ORIGINS`, preserving any other origins you use. Keep that configuration in the relay's deployment configuration so a later Worker redeploy retains it. Only the origin is needed, not a path. The relay's GitHub download host allowlist does not change.

Open the production URL and verify automatic Project startup, file upload, Save, checkpointed close/reopen and an actual remote Unit download. There is no separate welcome page or Open step; session controls stay collapsed unless startup fails. HTTP assets use `Cache-Control: no-store`; OPFS Project/resource/Jco caches are separate and still persist. Missing static paths return 404 rather than a fabricated app response. No cross-origin isolation headers are required for this execution model.

## Add a custom hostname

In the Pages project's **Custom domains**, add your chosen hostname and follow Cloudflare's DNS instructions. Add its HTTPS origin to the relay allowlist as well. Verify root-path imports and remote downloads on that hostname before directing users there.

Browser storage belongs to an **origin**. The `pages.dev` URL, preview URLs and a custom hostname have separate OPFS data; changing hostname does not migrate Projects. Download any files you need before moving between origins. Use one stable hostname for actual work and only one running app instance.
