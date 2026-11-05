'use strict';

/**
 * The site must be servable by GitHub Pages in "Deploy from a branch" mode.
 *
 * That mode needs no workflow and no token permissions, so it works on a fresh
 * repository the moment the maintainer picks the branch. It only requires the
 * publishable files to exist at the repo root.
 *
 * The Actions workflow cannot do this: the GITHUB_TOKEN is not allowed to
 * create a Pages site ("Resource not accessible by integration"), and the site
 * must additionally be switched to "GitHub Actions" mode by hand.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { publish, PUBLISHED, ROOT } = require('../../tools/publish-root');

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-root-'));
  // The publisher needs the sources it validates.
  fs.cpSync(path.join(ROOT, 'docs'), path.join(dir, 'docs'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'assets'), path.join(dir, 'assets'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

test('publishing puts the servable site at the repo root', () => {
  const root = tmpRoot();
  const result = publish({ root });

  PUBLISHED.forEach(name => {
    assert.ok(fs.existsSync(path.join(root, name)), 'missing ' + name + ' at the repo root');
  });
  [180, 192, 512].forEach(size => {
    assert.ok(
      fs.existsSync(path.join(root, 'icons', 'app-icon-' + size + '.png')),
      'missing icons/app-icon-' + size + '.png'
    );
  });
  assert.deepEqual(result.stale.sort(), PUBLISHED.concat(
    [180, 192, 512].map(s => 'icons/app-icon-' + s + '.png')
  ).sort());

  fs.rmSync(root, { recursive: true, force: true });
});

test('the published root page is the launcher, not the app', () => {
  const root = tmpRoot();
  publish({ root });

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /apple-touch-icon/i);
  assert.match(html, /navigator\.standalone/);
  assert.equal(/<iframe/i.test(html), false, 'must never frame the app');
  assert.equal(/google\.script\.run/.test(html), false, 'must not call the Apps Script API');

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.icons.length, 3);

  fs.rmSync(root, { recursive: true, force: true });
});

test('--check fails when the root copy is missing or stale', () => {
  const root = tmpRoot();

  assert.throws(() => publish({ root, check: true }), /stale/);

  publish({ root });
  assert.doesNotThrow(() => publish({ root, check: true }));

  // Corrupt one published file: the check must notice.
  fs.writeFileSync(path.join(root, 'index.html'), 'tampered', 'utf8');
  assert.throws(() => publish({ root, check: true }), /stale/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('the committed repo root already holds the published site', () => {
  // Guards against committing the tool but forgetting to run it.
  PUBLISHED.forEach(name => {
    assert.ok(fs.existsSync(path.join(ROOT, name)), 'repo root is missing ' + name);
  });
  [180, 192, 512].forEach(size => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'icons', 'app-icon-' + size + '.png')),
      'repo root is missing icons/app-icon-' + size + '.png'
    );
  });
});
