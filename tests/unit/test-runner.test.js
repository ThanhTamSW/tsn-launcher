'use strict';

/**
 * Test discovery contract.
 *
 * `npm test` used to pass quoted globs to `node --test`
 * (`tests/*.test.js`). Bash and PowerShell pass the quotes through, and glob
 * *expansion* of those arguments only exists in newer Node versions — on the
 * Node 20 runner in CI the command failed with "Could not find
 * '.../tests/*.test.js'" before running a single test.
 *
 * The suite therefore runs through `tests/run-tests.js`, which enumerates the
 * files itself. These tests pin that contract: the runner must pick up every
 * `*.test.js` under `tests/` and `tests/unit/`, and must fail the build when a
 * test fails.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { listTestFiles } = require('../run-tests');

const ROOT = path.join(__dirname, '..', '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('npm test runs the explicit-file runner instead of a quoted glob', () => {
  assert.match(PKG.scripts.test, /run-tests\.js/);
  assert.equal(/\*\.test\.js"/.test(PKG.scripts.test), false, 'a quoted glob breaks on older Node');
});

test('the runner finds every test file under tests/ and tests/unit/', () => {
  const files = listTestFiles(ROOT).map(f => path.relative(ROOT, f).replace(/\\/g, '/'));

  assert.ok(files.includes('tests/unit/pages-deploy.test.js'), 'missing the Pages deploy test');
  assert.ok(files.includes('tests/unit/app-icon-launcher.test.js'), 'missing the launcher test');

  const onDisk = [];
  const walk = (rel) => {
    fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).forEach(entry => {
      const next = rel + '/' + entry.name;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith('.test.js')) onDisk.push(next);
    });
  };
  walk('tests');

  assert.deepEqual(files.slice().sort(), onDisk.sort(), 'the runner must include every test file');
});

test('the runner skips helper files that are not tests', () => {
  const files = listTestFiles(ROOT).map(f => path.basename(f));
  ['harness.js', 'ui-harness.js', 'coverage.js', 'run-coverage.js', 'run-tests.js']
    .forEach(helper => assert.equal(files.includes(helper), false, 'must not run ' + helper));
});

test('the runner reports a failure as a non-zero exit code', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'unit', 'boom.test.js'),
    "const test = require('node:test');\ntest('boom', () => { throw new Error('nope'); });\n");

  const run = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run-tests.js'), '--root', dir], { encoding: 'utf8' });
  assert.equal(run.status, 1, run.stdout + run.stderr);
});

test('the runner succeeds for a directory with only passing tests', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(dir, 'tests', 'unit'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'unit', 'ok.test.js'),
    "const test = require('node:test');\ntest('ok', () => {});\n");

  const run = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run-tests.js'), '--root', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('the runner refuses a directory with no tests instead of passing vacuously', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsn-runner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  const run = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'run-tests.js'), '--root', dir], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stdout + run.stderr, /no test files/i);
});
