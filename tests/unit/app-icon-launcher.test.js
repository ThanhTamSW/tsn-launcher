'use strict';

/**
 * Phase 4 — static launcher page (guaranteed iOS icon).
 *
 * `HtmlOutput.setFaviconUrl()` is unreliable on iOS. The only dependable route
 * is a page the phone loads as a top-level document, carrying
 * `apple-touch-icon` and a web app manifest.
 *
 * The launcher must NOT embed the app in an iframe: Apps Script answers a
 * cross-origin framed request with HTTP 401, because an iframe cannot carry the
 * Google login session. The page therefore keeps the icon metadata in <head>
 * and, only when it already runs as an installed app, redirects the top-level
 * window to the app URL where login works.
 *
 * The redirect must NOT fire in a normal browser tab: iOS/Android read
 * `apple-touch-icon` from the document that is current when the user taps
 * "Add to Home Screen". An unconditional redirect replaces the launcher with
 * `/exec` (whose Google-generated <head> has no icon metadata) before that tap,
 * so the OS snapshots the wrong page and the phone shows a default icon.
 *
 * The launcher is generated, not hand-written, so tests can pin the contract:
 *   - required Apple/PWA metadata,
 *   - every declared icon exists and is an https URL of the right size,
 *   - the app URL is https, escaped into attributes, and used for the redirect,
 *   - the redirect is guarded by a standalone/display-mode check,
 *   - invalid config is rejected instead of producing a broken page.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildLauncher, validateAppUrl, validateIconBase } = require('../../tools/build-launcher');

const ROOT = path.join(__dirname, '..', '..');
const APP_URL = 'https://script.google.com/macros/s/AKfycbxEXAMPLE/exec';
const ICON_BASE = 'https://example.github.io/tsn/icons';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-launcher-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function build(t, overrides) {
  const outDir = (overrides && overrides.outDir) || tempDir(t);
  const result = buildLauncher(Object.assign({ appUrl: APP_URL, iconBase: ICON_BASE, outDir }, overrides));
  return result;
}

/* --------------------------- URL validation --------------------------- */

test('validateAppUrl accepts an Apps Script /exec https URL', () => {
  assert.equal(validateAppUrl(APP_URL), APP_URL);
});

test('validateAppUrl rejects non-https and markup', () => {
  for (const bad of [
    'http://script.google.com/macros/s/X/exec',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    ''
  ]) {
    assert.throws(() => validateAppUrl(bad), /https|URL|empty/i, 'must reject ' + JSON.stringify(bad));
  }
  assert.throws(() => validateAppUrl('https://x/a.png"><script>'), /invalid|character/i);
});

test('validateAppUrl rejects a quote that could break out of the script string', () => {
  assert.throws(() => validateAppUrl("https://x.com/a');alert(1);//"), /invalid|character/i);
  assert.throws(() => validateAppUrl('https://x.com/a\\";alert(1);//'), /invalid|character/i);
});

test('validateIconBase accepts a directory URL and normalises the trailing slash', () => {
  assert.equal(validateIconBase(ICON_BASE), ICON_BASE + '/');
  assert.equal(validateIconBase(ICON_BASE + '/'), ICON_BASE + '/');
});

test('validateIconBase rejects non-https or query strings', () => {
  for (const bad of ['http://example.com/icons', 'ftp://x/y', 'https://example.com/icons?x=1', '']) {
    assert.throws(() => validateIconBase(bad), /https|URL|empty/i, 'must reject ' + JSON.stringify(bad));
  }
});

/* ------------------------------ artifacts ------------------------------ */

test('buildLauncher writes index.html and manifest.json', (t) => {
  const result = build(t);
  assert.ok(fs.existsSync(result.htmlPath), 'missing launcher html');
  assert.ok(fs.existsSync(result.manifestPath), 'missing manifest.json');
  assert.equal(result.manifestPath.endsWith('manifest.json'), true);

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.name, 'Quản lý phòng tập');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#ffffff');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
});

test('the manifest declares 180, 192 and 512 icons with correct sizes and purposes', (t) => {
  const manifest = JSON.parse(fs.readFileSync(build(t).manifestPath, 'utf8'));
  const bySize = {};
  manifest.icons.forEach(i => { bySize[i.sizes] = i; });

  assert.ok(bySize['180x180'], 'missing 180x180');
  assert.ok(bySize['192x192'], 'missing 192x192');
  assert.ok(bySize['512x512'], 'missing 512x512');

  for (const size of ['180x180', '192x192', '512x512']) {
    const icon = bySize[size];
    assert.match(icon.src, /^https:\/\//, size + ' must use an absolute https URL');
    assert.equal(icon.type, 'image/png', size + ' must be PNG');
    assert.match(icon.src, /app-icon-(180|192|512)\.png$/, size + ' must point at the generated asset');
  }
  assert.equal(bySize['512x512'].purpose, 'any maskable');
});

test('index.html carries the Apple and PWA metadata iOS/Android read', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');

  assert.match(html, /<link[^>]+rel="apple-touch-icon"[^>]+href="https:\/\/[^"]*app-icon-180\.png"/i);
  assert.match(html, /<link[^>]+rel="manifest"[^>]+href="manifest\.json"/i);
  assert.match(html, /<meta[^>]+name="theme-color"[^>]+content="#[0-9a-fA-F]{6}"/i);
  assert.match(html, /<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/i);
  assert.match(html, /<meta[^>]+name="viewport"/i);
});

test('the launcher never embeds the app in an iframe', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');

  assert.equal(/<iframe/i.test(html), false, 'Apps Script answers framed requests with HTTP 401');
  assert.equal(/<frame/i.test(html), false, 'no legacy frame either');
});

test('the launcher redirects the top-level window to the app URL only in standalone mode', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');

  assert.ok(
    html.includes('location.replace("' + APP_URL + '")'),
    'the redirect must target the configured /exec URL'
  );
  assert.ok(html.indexOf('<script') > html.indexOf('<body>'), 'the redirect script belongs at the end of body');

  assert.ok(html.includes('navigator.standalone'), 'must detect an installed iOS app');
  assert.ok(html.includes('display-mode: standalone'), 'must detect an installed PWA via matchMedia');
  assert.match(html, /if\s*\(\s*standalone\s*\)/, 'location.replace must sit behind a standalone guard');
  assert.ok(
    html.indexOf('navigator.standalone') < html.indexOf('location.replace'),
    'the standalone check must run before the redirect'
  );
  assert.equal(html.includes('try{location.replace('), false,
    'the old unconditional try{location.replace( block must be gone');
  assert.equal(/<script>try\{location\.replace\(/.test(html), false,
    'no unconditional try{location.replace( script may start the page');
});

test('the launcher offers a visible fallback link for blocked redirects', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');

  assert.ok(html.includes('<a href="' + APP_URL + '">Mở ứng dụng</a>'), 'missing the fallback link');
});

test('the launcher copy works whether or not it auto-advances', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');

  assert.equal(/Đang mở ứng dụng/.test(html), false, 'the page no longer always opens the app');
  assert.match(html, /<h1>Quản lý phòng tập<\/h1>/, 'the title stays');
  // The subtitle must add information; repeating the title is a copy bug.
  assert.equal(/<p>Quản lý phòng tập<\/p>/.test(html), false, 'subtitle must not duplicate the title');
  assert.match(html, /<p>[^<]*khách hàng[^<]*<\/p>/, 'subtitle must describe the app');
  assert.ok(
    html.includes('Trên điện thoại: bấm Chia sẻ → “Thêm vào màn hình chính” để cài như ứng dụng.'),
    'must explain how to install it from a normal browser tab'
  );
  assert.match(html, /\.note\{[^}]*font-size:11px|\.note\{[^}]*font-size:12px/,
    'the install hint must be small print');
});

test('the launcher falls back to a noscript meta refresh', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));

  assert.match(head, /<noscript>/i);
  assert.match(head, /<meta[^>]+http-equiv="refresh"[^>]+content="0;\s*url=/i);
  assert.ok(head.includes(APP_URL), 'the noscript refresh must carry the app URL');
});

test('the launcher html escapes URL ampersands into attributes', (t) => {
  const queryUrl = 'https://script.google.com/macros/s/AKfycbxEXAMPLE/exec?a=1&b=2';
  const html = fs.readFileSync(build(t, { appUrl: queryUrl }).htmlPath, 'utf8');

  assert.ok(html.includes('href="' + queryUrl.replace('&', '&amp;') + '"'), 'the fallback href must be escaped');
  assert.equal(/href="[^"]*&(?!amp;)[^"]*"/.test(html), false, 'no raw ampersand may survive in an attribute');
  assert.ok(html.includes('href="' + queryUrl.replace('&', '&amp;') + '">Mở ứng dụng'), 'escaped fallback link');
});

test('the launcher html escapes the configured URLs into attributes', (t) => {
  const html = fs.readFileSync(build(t).htmlPath, 'utf8');
  assert.ok(html.indexOf(APP_URL) !== -1);
  assert.equal(html.indexOf('&quot;'), -1, 'a validated URL contains no characters needing escaping');
});

test('building twice is deterministic', (t) => {
  const outDir = tempDir(t);
  const first = build(t, { outDir });
  const html1 = fs.readFileSync(first.htmlPath, 'utf8');
  const manifest1 = fs.readFileSync(first.manifestPath, 'utf8');

  const second = build(t, { outDir });
  assert.equal(fs.readFileSync(second.htmlPath, 'utf8'), html1);
  assert.equal(fs.readFileSync(second.manifestPath, 'utf8'), manifest1);
});

test('buildLauncher rejects a missing app URL instead of writing a broken launcher', (t) => {
  const outDir = tempDir(t);
  assert.throws(() => buildLauncher({ appUrl: '', iconBase: ICON_BASE, outDir }), /appUrl|https/i);
  assert.equal(fs.existsSync(path.join(outDir, 'index.html')), false);
});

test('buildLauncher can embed the icon base as a path prefix for GitHub Pages', (t) => {
  const result = build(t, { iconBase: 'https://example.github.io/tsn/icons/' });
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  manifest.icons.forEach(i => assert.match(i.src, /^https:\/\/example\.github\.io\/tsn\/icons\//));
});

/* --------------------------- committed sample --------------------------- */

test('docs/launcher/ has a generated sample that the runbook can copy', () => {
  const dir = path.join(ROOT, 'docs', 'launcher');
  assert.ok(fs.existsSync(path.join(dir, 'index.html')), 'missing docs/launcher/index.html');
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), 'missing docs/launcher/manifest.json');

  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

  assert.match(html, /apple-touch-icon/i);
  assert.equal(/<iframe/i.test(html), false, 'the sample must redirect, not frame the app');
  assert.match(html, /https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/, 'the sample must redirect to the live deployment');
  assert.match(html, /<noscript>/i);
  assert.match(html, /http-equiv="refresh"/i);

  assert.ok(html.includes('navigator.standalone'), 'the sample must guard the redirect');
  assert.ok(html.includes('display-mode: standalone'), 'the sample must check display-mode');
  assert.match(html, /if\s*\(\s*standalone\s*\)/, 'the sample redirect must be conditional');
  assert.match(html, /<a\b[^>]*>Mở ứng dụng<\/a>/, 'the sample must keep the visible fallback link');
  assert.ok(
    html.includes('Trên điện thoại: bấm Chia sẻ → “Thêm vào màn hình chính” để cài như ứng dụng.'),
    'the sample must explain how to add the shortcut'
  );

  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons.length, 3);

  assert.ok(!/EXAMPLE|TODO|YOUR_/i.test(html), 'the sample must not ship placeholder tokens');
});
