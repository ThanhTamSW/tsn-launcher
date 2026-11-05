'use strict';

/**
 * Phase 7 — GitHub Pages deployment.
 *
 * The launcher and the app icons are hosted on GitHub Pages so the shortcut URL
 * never changes (`https://<user>.github.io/<repo>/`). Publishing this by hand
 * with a `cp -r` is how a broken artifact reaches a phone home screen, so the
 * publish step is a tested tool:
 *
 *   1. the launcher page and manifest must be the committed, runbook-generated
 *      ones (no placeholders, no iframe, real /exec redirect),
 *   2. the icons must be the validated PNGs from `assets/`,
 *   3. the output must contain *only* publishable files — never app source,
 *      clasp config or credentials.
 *
 * Validation happens before anything is written, so a failed build never
 * leaves a half-published folder behind.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildPagesSite,
  DEFAULTS,
  PAGES_SITE_FILES_BEFORE_ICONS,
  PAGES_SITE_URL
} = require('../../tools/build-pages');

const ROOT = path.join(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/* ------------------------------ helpers ------------------------------ */

/** A throwaway project root that mirrors the real layout, so a test can break one file. */
function fixtureRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-pages-root-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'docs', 'launcher'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });

  fs.copyFileSync(path.join(ROOT, 'docs', 'launcher', 'index.html'), path.join(dir, 'docs', 'launcher', 'index.html'));
  fs.copyFileSync(path.join(ROOT, 'docs', 'launcher', 'manifest.json'), path.join(dir, 'docs', 'launcher', 'manifest.json'));
  [180, 192, 512].forEach(size => {
    fs.copyFileSync(
      path.join(ROOT, 'assets', 'app-icon-' + size + '.png'),
      path.join(dir, 'assets', 'app-icon-' + size + '.png')
    );
  });
  return dir;
}

function outDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-pages-out-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'site');
}

/** Every file below `dir`, as posix paths, sorted. */
function listFiles(dir) {
  const out = [];
  const walk = (rel) => {
    fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).forEach(entry => {
      const next = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(next);
      else out.push(next);
    });
  };
  walk('');
  return out.sort();
}

/* ---------------------------- npm wiring ---------------------------- */

test('package.json exposes the pages build script', () => {
  assert.equal(PKG.scripts['pages:build'], 'node tools/build-pages.js');
});

test('the publish URL points at the tsn-launcher Pages site', () => {
  assert.equal(PAGES_SITE_URL, 'https://thanhtamsw.github.io/tsn-launcher/');
});

/* ------------------------------ output ------------------------------ */

test('buildPagesSite publishes exactly the launcher, the manifest, the icons and a README', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });

  const expected = PAGES_SITE_FILES_BEFORE_ICONS
    .concat([180, 192, 512].map(size => 'icons/app-icon-' + size + '.png'))
    .sort();

  assert.deepEqual(listFiles(result.outDir), expected);
});

test('the published launcher is the committed launcher, byte for byte', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });

  const published = fs.readFileSync(path.join(result.outDir, 'index.html'), 'utf8');
  const committed = fs.readFileSync(path.join(ROOT, 'docs', 'launcher', 'index.html'), 'utf8');
  assert.equal(published, committed);

  assert.match(published, /apple-touch-icon/i);
  assert.match(published, /https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/);
  assert.equal(/<iframe/i.test(published), false, 'Pages must redirect, never frame the app');
  assert.ok(published.includes('navigator.standalone'), 'the published launcher must guard the redirect');
  assert.match(published, /if\s*\(\s*standalone\s*\)/);
  assert.match(published, /<noscript>[\s\S]*http-equiv="refresh"/i);
  assert.match(published, /<a\b[^>]*>Mở ứng dụng<\/a>/);
});

test('the published manifest keeps the same-origin start_url the launcher needs', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });

  const manifest = JSON.parse(fs.readFileSync(path.join(result.outDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.icons.length, 3);
});

test('the published icons are the validated PNGs from assets/, byte for byte', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });

  [180, 192, 512].forEach(size => {
    const published = fs.readFileSync(path.join(result.outDir, 'icons', 'app-icon-' + size + '.png'));
    const source = fs.readFileSync(path.join(ROOT, 'assets', 'app-icon-' + size + '.png'));
    assert.equal(published.equals(source), true, 'icon ' + size + ' changed');
    assert.equal(published.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'icon ' + size + ' is not a PNG');
  });
});

test('.nojekyll is published so Pages serves files that start with an underscore', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });
  assert.ok(fs.existsSync(path.join(result.outDir, '.nojekyll')));
});

test('the README explains the live URL and how to rebuild', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });
  const readme = fs.readFileSync(path.join(result.outDir, 'README.md'), 'utf8');

  assert.match(readme, /https:\/\/thanhtamsw\.github\.io\/tsn-launcher\//);
  assert.match(readme, /pages:build/);
  assert.match(readme, /index\.html/);
  assert.match(readme, /icons\//);
});

/* --------------------------- validation --------------------------- */

/** Build a fixture, break one file, and assert a clean failure. */
function assertRejected(t, mutate, pattern) {
  const root = fixtureRoot(t);
  mutate(root);
  const out = outDir(t);

  assert.throws(() => buildPagesSite({ root, outDir: out }), pattern);
  assert.equal(fs.existsSync(out), false, 'a rejected build must not create the output folder');
}

test('buildPagesSite rejects a launcher that still contains a placeholder token', (t) => {
  assertRejected(t, (root) => {
    const file = path.join(root, 'docs', 'launcher', 'index.html');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Quản lý phòng tập', 'YOUR_APP'));
  }, /placeholder/i);
});

test('buildPagesSite rejects a launcher without an apple-touch-icon', (t) => {
  assertRejected(t, (root) => {
    const file = path.join(root, 'docs', 'launcher', 'index.html');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/rel="apple-touch-icon"/g, 'rel="icon-x"'));
  }, /apple-touch-icon/i);
});

test('buildPagesSite rejects a launcher that frames the app', (t) => {
  assertRejected(t, (root) => {
    const file = path.join(root, 'docs', 'launcher', 'index.html');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<body>', '<body><iframe src="https://invalid.test"></iframe>'));
  }, /iframe/i);
});

test('buildPagesSite rejects a launcher that does not redirect to an https /exec deployment', (t) => {
  assertRejected(t, (root) => {
    const file = path.join(root, 'docs', 'launcher', 'index.html');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/https:\/\/script\.google\.com\/macros\/s\/[^/"]+\/exec/g, 'http://invalid.test'));
  }, /deployment/i);
});

test('buildPagesSite rejects a corrupt icon and names the file', (t) => {
  assertRejected(t, (root) => {
    fs.writeFileSync(path.join(root, 'assets', 'app-icon-192.png'), 'not a png');
  }, /app-icon-192\.png/);
});

test('buildPagesSite rejects a missing launcher instead of publishing an empty site', (t) => {
  assertRejected(t, (root) => {
    fs.rmSync(path.join(root, 'docs', 'launcher', 'index.html'));
  }, /index\.html/i);
});

test('buildPagesSite rejects a missing manifest', (t) => {
  assertRejected(t, (root) => {
    fs.rmSync(path.join(root, 'docs', 'launcher', 'manifest.json'));
  }, /manifest\.json/i);
});

test('buildPagesSite rejects a manifest that is not valid JSON', (t) => {
  assertRejected(t, (root) => {
    fs.writeFileSync(path.join(root, 'docs', 'launcher', 'manifest.json'), '{ not json');
  }, /not valid JSON/i);
});

test('buildPagesSite rejects a manifest that declares no icons', (t) => {
  assertRejected(t, (root) => {
    fs.writeFileSync(path.join(root, 'docs', 'launcher', 'manifest.json'),
      JSON.stringify({ start_url: './', scope: './', icons: [] }));
  }, /no icons/i);
});

test('buildPagesSite rejects a manifest whose start_url leaves the Pages origin', (t) => {
  assertRejected(t, (root) => {
    fs.writeFileSync(path.join(root, 'docs', 'launcher', 'manifest.json'),
      JSON.stringify({ start_url: 'https://script.google.com/', scope: 'https://script.google.com/', icons: [{ src: 'x' }] }));
  }, /same-origin|start_url/i);
});

test('buildPagesSite rejects a missing icon folder instead of publishing a partial set', (t) => {
  assertRejected(t, (root) => {
    fs.rmSync(path.join(root, 'assets'), { recursive: true, force: true });
  }, /missing icon/i);
});

test('buildPagesSite requires an output directory', () => {
  assert.throws(() => buildPagesSite({ root: ROOT, outDir: '' }), /out/i);
});

test('buildPagesSite defaults to _site so the npm script works without flags', () => {
  assert.equal(DEFAULTS.outDir, path.join(ROOT, '_site'));
});

test('buildPagesSite refuses to wipe the project root or a source folder', (t) => {
  // The output folder is deleted before writing, so pointing it at the project
  // root (or docs/, which holds the runbooks and the launcher source) would
  // destroy tracked files.
  assert.throws(() => buildPagesSite({ root: ROOT, outDir: ROOT }), /root|source/i);
  assert.throws(() => buildPagesSite({ root: ROOT, outDir: path.join(ROOT, 'docs') }), /root|source/i);
  assert.throws(() => buildPagesSite({ root: ROOT, outDir: path.join(ROOT, 'package.json') }), /root|source/i);

  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'deploy-pages.md')), 'a refused build must not delete the runbooks');
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'launcher', 'index.html')), 'a refused build must not delete the launcher source');
});

/* ----------------------------- safety ----------------------------- */

test('the published site never contains app source, clasp config or credentials', (t) => {
  const result = buildPagesSite({ root: ROOT, outDir: outDir(t) });
  const files = listFiles(result.outDir);

  const forbidden = /(^|\/)(Code\.js|UI\.html|appsscript\.json|\.clasp\.json|\.clasprc\.json|package\.json|\.git)(\/|$)/;
  files.forEach(file => assert.equal(forbidden.test(file), false, 'must not publish ' + file));

  const readme = fs.readFileSync(path.join(result.outDir, 'README.md'), 'utf8');
  assert.equal(/scriptId|1YgKHwtS9UGFxQQHE5V8940c/i.test(readme), false, 'must not publish the script ID');
});

test('a second build replaces the previous output instead of merging stale files', (t) => {
  const out = outDir(t);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'stale.html'), 'old');

  const result = buildPagesSite({ root: ROOT, outDir: out });

  assert.equal(fs.existsSync(path.join(result.outDir, 'stale.html')), false, 'stale file survived the build');
  assert.deepEqual(listFiles(result.outDir), PAGES_SITE_FILES_BEFORE_ICONS
    .concat([180, 192, 512].map(size => 'icons/app-icon-' + size + '.png'))
    .sort());
});

/* ------------------------------- CLI ------------------------------- */

test('the pages CLI builds the site and reports the folder', (t) => {
  const { spawnSync } = require('node:child_process');
  const TOOL = path.join(ROOT, 'tools', 'build-pages.js');
  const out = outDir(t);

  const run = spawnSync(process.execPath, [TOOL, '--out', out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.match(run.stdout, /index\.html|site/i);
});

test('the pages CLI exits 1 with a clear message for a broken project', (t) => {
  const { spawnSync } = require('node:child_process');
  const TOOL = path.join(ROOT, 'tools', 'build-pages.js');
  const root = fixtureRoot(t);
  fs.rmSync(path.join(root, 'docs', 'launcher', 'manifest.json'));

  const run = spawnSync(process.execPath, [TOOL, '--root', root, '--out', outDir(t)], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stdout + run.stderr, /manifest\.json/i);
});

test('the pages CLI rejects unknown arguments instead of guessing', (t) => {
  const { spawnSync } = require('node:child_process');
  const TOOL = path.join(ROOT, 'tools', 'build-pages.js');

  const run = spawnSync(process.execPath, [TOOL, '--nope'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stdout + run.stderr, /unknown argument/i);
});
