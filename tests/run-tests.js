'use strict';

/**
 * Run the test suite by enumerating files, not by passing a glob to Node.
 *
 * `node --test "tests/*.test.js"` relies on Node expanding the pattern itself,
 * which older runtimes (the Node 20 GitHub Actions image, for example) do not
 * do: the command aborts with "Could not find '...tests/*.test.js'" and the
 * whole deploy gate reports failure without running a test. Listing the files
 * here works on every Node version and keeps the gate honest.
 *
 * Usage:
 *   node tests/run-tests.js
 *   node tests/run-tests.js --root <dir>   # used by the runner's own tests
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

/** Directories (relative to the root) that may hold tests. */
const TEST_DIRS = ['tests', 'tests/unit'];

/**
 * Every `*.test.js` under the test directories, sorted for stable output.
 *
 * @param {string} [root]
 * @returns {string[]} absolute paths
 */
function listTestFiles(root) {
  const base = path.resolve(root || ROOT);
  const files = [];

  TEST_DIRS.forEach(rel => {
    const dir = path.join(base, rel);
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      if (!entry.isFile() || !entry.name.endsWith('.test.js')) return;
      files.push(path.join(dir, entry.name));
    });
  });

  return files.sort();
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('--root needs a directory');
      options.root = next;
      i++;
    } else {
      throw new Error('unknown argument ' + argv[i]);
    }
  }
  return options;
}

function main(argv) {
  const files = listTestFiles(parseArgs(argv || []).root);

  if (!files.length) {
    console.error('run-tests: no test files found under ' + TEST_DIRS.join(', '));
    process.exitCode = 1;
    return;
  }

  // A parent `node --test` exports NODE_TEST_CONTEXT; leaving it in place makes
  // the child think it is nested inside a test file and skip every file.
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;

  const result = spawnSync(process.execPath, ['--test'].concat(files), { stdio: 'inherit', env: env });
  if (result.error) {
    console.error('run-tests: ' + result.error.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error('run-tests: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = { listTestFiles, parseArgs, TEST_DIRS };
