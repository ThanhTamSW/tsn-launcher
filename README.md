# TSN — launcher

Static GitHub Pages site for the web app home-screen shortcut.

- Live URL: https://thanhtamsw.github.io/tsn-app/
- Repo: https://github.com/ThanhTamSW/tsn-app
- Page: `index.html` (keeps the `apple-touch-icon` metadata and redirects
  top-level to the deployed Apps Script web app).
- Icons: `icons/` (180, 192, 512 PNG).
- Manifest: `manifest.json` (`start_url` and `scope` stay `./`, same origin).

This branch publishes only the shortcut site. The Apps Script source lives on
the `app` branch and is deployed with `clasp` from there.

## Test & build

```bash
npm install
npm test          # launcher, icon and Pages contract tests
npm run pages:build
```

`_site/` is generated and never committed. The Pages workflow builds and
publishes it from the `launcher` branch after the suite passes.

Runbook: [`docs/deploy-pages.md`](docs/deploy-pages.md).
