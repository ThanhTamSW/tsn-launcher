'use strict';

/**
 * BUG 3 - iOS picks the closest `apple-touch-icon` it understands, so the
 * launcher must declare the common iPhone/iPad sizes instead of only 180.
 *
 * 152 (iPad), 167 (iPad Pro) and 180 (iPhone) all resolve to Cloudinary PNGs
 * at the matching square crop. The web app manifest keeps the PWA sizes
 * (180/192/512); Apple link tags are a separate list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildLauncher,
  APPLE_TOUCH_SIZES
} = require('../../tools/build-launcher');

const ROOT = path.join(__dirname, '..', '..');
const APP_URL = 'https://script.google.com/macros/s/AKfycbxEXAMPLE/exec';
const CLOUD = 'uxvmo47y';
const PUBLIC_ID = 'logo';
const CDN = 'https://res.cloudinary.com/' + CLOUD + '/image/upload/';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-launcher-apple-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildCloudinary(t) {
  return buildLauncher({
    appUrl: APP_URL,
    cloudinary: { cloudName: CLOUD, publicId: PUBLIC_ID },
    outDir: tempDir(t)
  });
}

function appleLinks(html) {
  const links = [];
  const re = /<link[^>]+rel="apple-touch-icon"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    links.push({
      tag: tag,
      size: (/\bsizes="(\d+)x(\d+)"/i.exec(tag) || [])[1],
      href: (/\bhref="([^"]+)"/i.exec(tag) || [])[1]
    });
  }
  return links;
}

test('the launcher declares the 152, 167 and 180 apple-touch-icon sizes', () => {
  assert.deepEqual(APPLE_TOUCH_SIZES, [152, 167, 180]);
});

test('every apple-touch-icon points at the Cloudinary crop for its own size', (t) => {
  const html = fs.readFileSync(buildCloudinary(t).htmlPath, 'utf8');
  const links = appleLinks(html);

  assert.equal(links.length, 3, 'expected exactly three apple-touch-icon links');
  assert.deepEqual(links.map(l => l.size), ['152', '167', '180']);

  links.forEach(link => {
    const n = Number(link.size);
    assert.equal(link.href, CDN + 'f_png/q_auto/c_fill,h_' + n + ',w_' + n + '/' + PUBLIC_ID);
    assert.match(link.tag, new RegExp('sizes="' + n + 'x' + n + '"'), link.tag);
  });
});

test('the manifest keeps only the PWA icon sizes, not the Apple extras', (t) => {
  const manifest = JSON.parse(fs.readFileSync(buildCloudinary(t).manifestPath, 'utf8'));
  assert.deepEqual(manifest.icons.map(i => i.sizes), ['180x180', '192x192', '512x512']);
});

test('the committed launcher carries all three Apple sizes from Cloudinary', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'launcher', 'index.html'), 'utf8');

  assert.equal(/tsn-gym\.github\.io/.test(html), false, 'the GitHub Pages icons return 404');

  const links = appleLinks(html);
  assert.deepEqual(links.map(l => l.size), ['152', '167', '180']);
  links.forEach(link => {
    const n = Number(link.size);
    assert.equal(
      link.href,
      'https://res.cloudinary.com/uxvmo47y/image/upload/f_png/q_auto/c_fill,h_' + n + ',w_' + n + '/logo',
      link.tag
    );
  });
});

test('the committed launcher still declares the 192px browser favicon', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'launcher', 'index.html'), 'utf8');
  assert.match(html, /<link[^>]+rel="icon"[^>]+sizes="192x192"/i);
  assert.match(html, /c_fill,h_192,w_192\/logo/);
});

test('a file-hosted icon set without the extra sizes degrades to one Apple link', (t) => {
  const outDir = tempDir(t);
  const result = buildLauncher({
    appUrl: APP_URL,
    iconBase: 'https://example.github.io/icons',
    outDir
  });

  const html = fs.readFileSync(result.htmlPath, 'utf8');
  const links = appleLinks(html);

  assert.equal(links.length, 1, 'only the sizes that exist may be declared');
  assert.equal(links[0].size, '180');
  assert.equal(links[0].href, 'https://example.github.io/icons/app-icon-180.png');
});
