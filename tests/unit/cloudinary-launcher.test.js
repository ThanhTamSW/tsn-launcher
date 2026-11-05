'use strict';

/**
 * Cloudinary-backed icons on the iOS launcher.
 *
 * The launcher is the only top-level document iOS reads when a shortcut is
 * added, so `apple-touch-icon` there decides the home-screen icon. Hosting the
 * PNGs on GitHub Pages is one option; Cloudinary is the other, and it must use
 * the same delivery URLs the React sample produces (`f_png/q_auto`, square
 * `c_fill` at 180/192/512).
 *
 * The two sources are mutually exclusive: a launcher that half-points at one
 * host and half at another produces an icon nobody can reproduce.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildLauncher, parseCloudinary } = require('../../tools/build-launcher');
const { ICON_SIZES, DEFAULT_CLOUD_NAME } = require('../../tools/cloudinary-url');

const APP_URL = 'https://script.google.com/macros/s/AKfycbxEXAMPLE/exec';
const CLOUD_NAME = 'uxvmo47y';
const PUBLIC_ID = 'tsn/app-icon';
const CDN = 'https://res.cloudinary.com/' + CLOUD_NAME + '/image/upload/';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-launcher-cloudinary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildWithCloudinary(t, overrides) {
  const outDir = tempDir(t);
  return buildLauncher(Object.assign({
    appUrl: APP_URL,
    cloudinary: { cloudName: CLOUD_NAME, publicId: PUBLIC_ID },
    outDir
  }, overrides));
}

/* --------------------------- selection contract --------------------------- */

test('buildLauncher accepts a Cloudinary icon source', (t) => {
  const result = buildWithCloudinary(t);
  assert.ok(fs.existsSync(result.htmlPath));
  assert.ok(fs.existsSync(result.manifestPath));
});

test('buildLauncher rejects both icon sources at once', (t) => {
  const outDir = tempDir(t);
  assert.throws(
    () => buildLauncher({
      appUrl: APP_URL,
      iconBase: 'https://example.github.io/icons',
      cloudinary: { cloudName: CLOUD_NAME, publicId: PUBLIC_ID },
      outDir
    }),
    /one|both|exclusive/i
  );
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
});

test('buildLauncher rejects a launcher with no icon source at all', (t) => {
  const outDir = tempDir(t);
  assert.throws(() => buildLauncher({ appUrl: APP_URL, outDir }), /icon/i);
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
});

test('buildLauncher rejects an incomplete Cloudinary configuration', (t) => {
  const outDir = tempDir(t);
  assert.throws(
    () => buildLauncher({ appUrl: APP_URL, cloudinary: { cloudName: '', publicId: PUBLIC_ID }, outDir }),
    /cloudName/i
  );
  assert.throws(
    () => buildLauncher({ appUrl: APP_URL, cloudinary: { cloudName: CLOUD_NAME, publicId: '' }, outDir }),
    /icon/i
  );
});

test('buildLauncher defaults the Cloudinary cloud name to the project cloud', (t) => {
  const html = fs.readFileSync(
    buildLauncher({
      appUrl: APP_URL,
      cloudinary: { publicId: PUBLIC_ID },
      outDir: tempDir(t)
    }).htmlPath,
    'utf8'
  );
  assert.ok(html.includes('https://res.cloudinary.com/' + CLOUD_NAME + '/'));
});

test('buildLauncher rejects a Cloudinary public ID that could break the attribute', (t) => {
  const outDir = tempDir(t);
  assert.throws(
    () => buildLauncher({
      appUrl: APP_URL,
      cloudinary: { cloudName: CLOUD_NAME, publicId: 'icon"><script>alert(1)</script>' },
      outDir
    }),
    /publicId/i
  );
});

/* ------------------------------- artifacts ------------------------------- */

test('the launcher apple-touch-icon set includes the Cloudinary 180px PNG', (t) => {
  const html = fs.readFileSync(buildWithCloudinary(t).htmlPath, 'utf8');
  const link = /<link[^>]+rel="apple-touch-icon"[^>]+sizes="180x180"[^>]+href="([^"]+)"/i.exec(html);
  assert.ok(link, 'missing the 180x180 apple-touch-icon');
  assert.equal(
    link[1],
    CDN + 'f_png/q_auto/c_fill,h_180,w_180/' + PUBLIC_ID
  );
  assert.match(link[1], /^https:\/\/res\.cloudinary\.com\//);
  assert.equal(
    (html.match(/rel="apple-touch-icon"/g) || []).length,
    3,
    'iOS picks the closest of 152/167/180'
  );
});

test('the launcher declares every home-screen size from Cloudinary', (t) => {
  const manifest = JSON.parse(fs.readFileSync(buildWithCloudinary(t).manifestPath, 'utf8'));
  const bySize = {};
  manifest.icons.forEach(icon => { bySize[icon.sizes] = icon; });

  assert.deepEqual(manifest.icons.map(i => i.sizes), ICON_SIZES.map(s => s + 'x' + s));
  ICON_SIZES.forEach(size => {
    const icon = bySize[size + 'x' + size];
    assert.ok(icon, 'missing ' + size);
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.src, CDN + 'f_png/q_auto/c_fill,h_' + size + ',w_' + size + '/' + PUBLIC_ID);
  });
  assert.equal(bySize['512x512'].purpose, 'any maskable');
});

test('the launcher does not emit a stale GitHub Pages icon when Cloudinary is used', (t) => {
  const html = fs.readFileSync(buildWithCloudinary(t).htmlPath, 'utf8');
  const manifest = fs.readFileSync(buildWithCloudinary(t).manifestPath, 'utf8');
  assert.equal(/github\.io/.test(html), false);
  assert.equal(/github\.io/.test(manifest), false);
});

test('the Cloudinary launcher redirects instead of framing the app', (t) => {
  const html = fs.readFileSync(buildWithCloudinary(t).htmlPath, 'utf8');
  assert.equal(/<iframe/i.test(html), false, 'Apps Script refuses to render in a cross-origin iframe (HTTP 401)');
  assert.ok(html.includes('location.replace("' + APP_URL + '")'), 'must redirect to the app URL');
  assert.ok(html.includes('<a href="' + APP_URL + '">Mở ứng dụng</a>'), 'must keep the fallback link');
  assert.ok(html.includes('navigator.standalone'), 'must detect an installed iOS app');
  assert.ok(html.includes('display-mode: standalone'), 'must detect an installed PWA');
  assert.match(html, /if\s*\(\s*standalone\s*\)/, 'the redirect must only fire when installed');
  assert.ok(
    html.indexOf('navigator.standalone') < html.indexOf('location.replace'),
    'a normal browser tab must stay put so the OS reads the icon'
  );
});

test('building twice with Cloudinary is deterministic', (t) => {
  const outDir = tempDir(t);
  const first = buildWithCloudinary(t, { outDir });
  const html1 = fs.readFileSync(first.htmlPath, 'utf8');
  const manifest1 = fs.readFileSync(first.manifestPath, 'utf8');

  const second = buildWithCloudinary(t, { outDir });
  assert.equal(fs.readFileSync(second.htmlPath, 'utf8'), html1);
  assert.equal(fs.readFileSync(second.manifestPath, 'utf8'), manifest1);
});

test('buildLauncherDefaults records the project cloud for the sample', () => {
  const { DEFAULTS } = require('../../tools/build-launcher');
  assert.equal(DEFAULTS.cloudinary.cloudName, DEFAULT_CLOUD_NAME);
});

/* ----------------------------- CLI parsing ----------------------------- */

test('parseCloudinary splits <cloud>/<public ID>', () => {
  assert.deepEqual(parseCloudinary(CLOUD_NAME + '/' + PUBLIC_ID), {
    cloudName: CLOUD_NAME,
    publicId: PUBLIC_ID
  });
});

test('parseCloudinary accepts a pasted Cloudinary delivery URL', () => {
  const pasted = 'https://res.cloudinary.com/' + CLOUD_NAME + '/image/upload/v1/' + PUBLIC_ID;
  assert.deepEqual(parseCloudinary(pasted), { cloudName: CLOUD_NAME, publicId: PUBLIC_ID });
});

test('parseCloudinary accepts a delivery URL without a version segment', () => {
  const pasted = CDN + 'f_png/q_auto/c_fill,h_180,w_180/' + PUBLIC_ID;
  assert.deepEqual(parseCloudinary(pasted), { cloudName: CLOUD_NAME, publicId: PUBLIC_ID });
});

test('parseCloudinary rejects a value without a public ID', () => {
  for (const bad of ['', CLOUD_NAME, CLOUD_NAME + '/', null]) {
    assert.throws(() => parseCloudinary(bad), /cloudinary|public ID|cloud name/i, JSON.stringify(bad));
  }
});

test('the launcher CLI writes a Cloudinary launcher', (t) => {
  const { spawnSync } = require('node:child_process');
  const ROOT = path.join(__dirname, '..', '..');
  const outDir = tempDir(t);

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'build-launcher.js'),
    '--app-url', APP_URL,
    '--cloudinary', CLOUD_NAME + '/' + PUBLIC_ID,
    '--out', outDir
  ], { encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr);
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  assert.ok(html.includes(CDN + 'f_png/q_auto/c_fill,h_180,w_180/' + PUBLIC_ID));
});

test('the launcher CLI refuses both icon sources', (t) => {
  const { spawnSync } = require('node:child_process');
  const ROOT = path.join(__dirname, '..', '..');
  const outDir = tempDir(t);

  const run = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'build-launcher.js'),
    '--app-url', APP_URL,
    '--icon-base', 'https://example.github.io/icons',
    '--cloudinary', CLOUD_NAME + '/' + PUBLIC_ID,
    '--out', outDir
  ], { encoding: 'utf8' });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /exactly one|both/i);
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
});
