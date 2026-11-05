'use strict';

/**
 * Phase 7 — repository and deployment contract.
 *
 * The project is published to `github.com/ThanhTamSW/tsn-app`, which is
 * also the GitHub Pages host for the launcher. That means the repo itself is
 * the deployment artifact, so two things must be guaranteed by tests:
 *
 *   1. secrets and throwaway output can never be committed (`.gitignore`),
 *   2. the runbook documents the exact live URL and the publish steps.
 *
 * Committing `~/.clasprc.json` (the clasp OAuth token) would hand out full
 * Apps Script access, and committing a stale `_site/` would publish yesterday's
 * launcher — both are silent failures, so they are tested rather than assumed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

const REPO_URL = 'https://github.com/ThanhTamSW/tsn-app';
const PAGES_URL = 'https://thanhtamsw.github.io/tsn-app/';

function read(rel) {
  const file = path.join(ROOT, rel);
  assert.ok(fs.existsSync(file), 'missing ' + rel);
  return fs.readFileSync(file, 'utf8');
}

/** Parse .gitignore into normalised patterns (comments and blanks dropped). */
function gitignorePatterns() {
  return read('.gitignore')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/* --------------------------- secrets --------------------------- */

test('the repo ignores clasp credentials and never commits them', () => {
  const patterns = gitignorePatterns().map(p => p.toLowerCase());
  ['.clasprc.json', 'node_modules/'].forEach(expected => {
    assert.ok(patterns.includes(expected), '.gitignore must contain ' + expected);
  });
  assert.equal(fs.existsSync(path.join(ROOT, '.clasprc.json')), false,
    'a clasp credential file must not live in the repository');
});

test('the repo ignores generated Pages output instead of committing it', () => {
  const patterns = gitignorePatterns();
  assert.ok(patterns.some(p => /^\/?_site\/?$/.test(p)), '.gitignore must ignore _site/');
});

test('local and OS noise stays out of the repo', () => {
  const patterns = gitignorePatterns();
  assert.ok(patterns.some(p => /^\.env/.test(p)), '.gitignore must ignore .env files');
  assert.ok(patterns.some(p => /^\/?\.DS_Store$/.test(p)), '.gitignore must ignore .DS_Store');
});

test('throwaway verification logs are not published with the source', () => {
  const patterns = gitignorePatterns();
  assert.ok(patterns.includes('VERIFY-*.txt'), '.gitignore must ignore VERIFY-*.txt scratch logs');
  assert.ok(patterns.includes('TEST-REPORT.txt'), '.gitignore must ignore the generated TEST-REPORT.txt');
});

/* --------------------------- deploy runbook --------------------------- */

test('the deployment runbook names the repository and the live Pages URL', () => {
  const text = read(path.join('docs', 'deploy-pages.md'));

  assert.ok(text.includes(REPO_URL), 'must name ' + REPO_URL);
  assert.ok(text.includes(PAGES_URL), 'must name the live URL ' + PAGES_URL);
});

test('the deployment runbook documents building, committing and enabling Pages', () => {
  const text = read(path.join('docs', 'deploy-pages.md'));

  assert.match(text, /pages:build/, 'must document npm run pages:build');
  assert.match(text, /_site/, 'must name the published folder');
  assert.match(text, /git (add|commit|push)/, 'must document committing the site');
  assert.match(text, /Settings.*Pages|Pages.*Settings/is, 'must explain where Pages is enabled');
  assert.match(text, /deploy from a branch|branch/i, 'must state the Pages source (branch/folder)');
});

test('the deployment runbook links the launcher and icon runbooks', () => {
  const text = read(path.join('docs', 'deploy-pages.md'));
  assert.match(text, /app-icon\.md/, 'must link the icon runbook');
  assert.match(text, /clasp push/, 'must explain that the web app itself is pushed with clasp');
});

test('the deployment runbook states the iframe limitation instead of promising an embed', () => {
  const text = read(path.join('docs', 'deploy-pages.md'));
  assert.match(text, /iframe/i);
  assert.match(text, /401/, 'must name the HTTP 401 the frame would return');
});

/* --------------------------- entry point --------------------------- */

test('the README points a new maintainer at the tests and the deploy runbook', () => {
  const text = read('README.md');
  assert.match(text, /npm test/, 'must document the test command');
  assert.match(text, /deploy-pages\.md/, 'must link the deployment runbook');
  assert.match(text, /pages:build/, 'must document the pages build command');
});

/* --------------------------- CI workflow --------------------------- */

test('the Pages workflow tests before publishing and deploys an artifact', () => {
  const text = read(path.join('.github', 'workflows', 'pages.yml'));

  assert.match(text, /npm test/, 'the site must not publish on a red test suite');
  assert.match(text, /pages:build/, 'must build the site with the tested tool');
  assert.match(text, /actions\/upload-pages-artifact/, 'must upload the built site as an artifact');
  assert.match(text, /actions\/deploy-pages/, 'must deploy with the Pages action');
  assert.match(text, /path:\s*_site/, 'must upload the built folder, not the repo root');
});

test('the Pages workflow can enable Pages on a fresh repository', () => {
  const text = read(path.join('.github', 'workflows', 'pages.yml'));

  // A brand-new repo has Pages disabled; configure-pages fails with
  // "Get Pages site failed" unless it is allowed to create the site.
  assert.match(
    text,
    /configure-pages@[\s\S]*?enablement:\s*true/,
    'must let configure-pages create the Pages site so the first run succeeds'
  );
});

test('the Pages workflow only publishes from main and declares the needed permissions', () => {
  const text = read(path.join('.github', 'workflows', 'pages.yml'));

  // This repo is standalone: its default and only branch is `main`.
  // (The split repo used `launcher`; keeping that here would disable Pages.)
  assert.match(text, /branches:\s*(\[[^\]]*main[^\]]*\]|[\s\S]*?-\s*main)/, 'must be limited to the main branch');
  assert.equal(/-\s*launcher\b/.test(text), false, 'must not wait for a launcher branch that does not exist here');
  assert.match(text, /pages:\s*write/, 'must request pages: write');
  assert.match(text, /id-token:\s*write/, 'must request id-token: write for OIDC deploy');
  assert.match(text, /concurrency:/, 'must not run overlapping deployments');
});
