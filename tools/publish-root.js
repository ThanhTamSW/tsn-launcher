'use strict';

/**
 * Publish the launcher site into the repository root.
 *
 * Why not GitHub Actions?
 *
 * The Pages workflow needs the repository to be switched to "GitHub Actions"
 * mode, and the GITHUB_TOKEN cannot create the Pages site itself
 * ("Resource not accessible by integration"). That makes the first deploy a
 * manual, easy-to-miss step that fails with an opaque error.
 *
 * "Deploy from a branch" needs no workflow and no token permissions: the
 * maintainer picks the branch once, and Pages serves whatever is committed.
 * So this script copies the *publishable* files to the repo root, where the
 * branch-based publisher finds them:
 *
 *   index.html, manifest.json, README.md, .nojekyll, icons/*.png
 *
 * Everything else (docs/, tools/, tests/, assets/) stays in the repo for
 * maintenance but is not part of the site root.
 *
 * Usage:
 *   node tools/publish-root.js          # write the site to the repo root
 *   node tools/publish-root.js --check  # fail if the root copy is stale
 */

const fs = require('node:fs');
const path = require('node:path');

const { buildPagesSite } = require('./build-pages');

const ROOT = path.join(__dirname, '..');

/** Files the branch publisher serves, relative to the repo root. */
const PUBLISHED = ['index.html', 'manifest.json', '.nojekyll'];

function publish(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || ROOT);
  const check = !!opts.check;

  // Build into a scratch folder first so a validation failure never leaves the
  // repo root half-written.
  const staging = path.join(root, '.site-build');
  const result = buildPagesSite({ root, outDir: staging });

  const stale = [];
  const writes = [];

  PUBLISHED.forEach(name => {
    const from = path.join(result.outDir, name);
    const to = path.join(root, name);
    const next = fs.readFileSync(from, 'utf8');
    const prev = fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : null;
    if (prev !== next) stale.push(name);
    writes.push([to, next]);
  });

  // Icons live under icons/ so the manifest's relative URLs keep working.
  const iconDir = path.join(root, 'icons');
  result.files
    .filter(f => f.startsWith('icons/'))
    .forEach(f => {
      const from = path.join(result.outDir, f);
      const to = path.join(root, f);
      const next = fs.readFileSync(from);
      const prev = fs.existsSync(to) ? fs.readFileSync(to) : null;
      if (!prev || !prev.equals(next)) stale.push(f);
      writes.push([to, next]);
    });

  if (check) {
    fs.rmSync(staging, { recursive: true, force: true });
    if (stale.length) {
      throw new Error(
        'publish-root: the repo root is stale (' + stale.join(', ') +
        '). Run `npm run pages:publish`.'
      );
    }
    return { outDir: root, files: PUBLISHED.concat(result.files.filter(f => f.startsWith('icons/'))), stale: [] };
  }

  fs.mkdirSync(iconDir, { recursive: true });
  writes.forEach(([to, data]) => fs.writeFileSync(to, data));
  fs.rmSync(staging, { recursive: true, force: true });

  return {
    outDir: root,
    files: PUBLISHED.concat(result.files.filter(f => f.startsWith('icons/'))),
    stale
  };
}

function main(argv) {
  const check = argv.indexOf('--check') !== -1;
  try {
    const result = publish({ check });
    if (check) {
      console.log('publish-root: repo root is up to date (' + result.files.length + ' files)');
    } else {
      console.log('publish-root: wrote ' + result.files.length + ' files to the repo root:');
      result.files.forEach(f => console.log('  ' + f));
      console.log('');
      console.log('Next: commit and push. Pages (branch mode) serves these files.');
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { publish, PUBLISHED, ROOT };
