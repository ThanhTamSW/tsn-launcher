'use strict';

/**
 * Build the GitHub Pages site for the home-screen launcher.
 *
 * Pages is the fixed-URL host the runbook recommends
 * (`docs/app-icon.md` §6): the shortcut URL never changes when a new Apps
 * Script deployment is created. Publishing by hand (`cp -r docs/launcher`)
 * is how a stale or half-copied artifact reaches a phone, so this tool makes
 * the publish step reproducible and refuses to write a broken site:
 *
 *   - the launcher and manifest must be the committed, runbook-generated files,
 *   - the launcher must carry `apple-touch-icon`, must NOT frame the app
 *     (Apps Script answers a cross-origin frame with HTTP 401 — the page has to
 *     redirect top-level), and must redirect to an https `/exec` deployment,
 *   - the icons must be the validated PNGs from `assets/`,
 *   - nothing else is published: no `Code.js`, `UI.html`, clasp config,
 *     `package.json` or credentials.
 *
 * Every check runs before the output folder is touched, so a rejected build
 * leaves no partial site behind.
 *
 * Usage:
 *   node tools/build-pages.js
 *   node tools/build-pages.js --out _site
 */

const fs = require('node:fs');
const path = require('node:path');

const { checkIcons, ICON_SIZES } = require('./check-icon');

const ROOT = path.join(__dirname, '..');

const PAGES_SITE_URL = 'https://thanhtamsw.github.io/tsn-app/';

/** Files written before the icons, in build order. */
const PAGES_SITE_FILES_BEFORE_ICONS = ['index.html', 'manifest.json', 'README.md', '.nojekyll'];

const DEFAULTS = {
  root: ROOT,
  outDir: path.join(ROOT, '_site')
};

const LAUNCHER_DIR = path.join('docs', 'launcher');
const ICON_DIR = 'icons';

/** `YOUR_`, `EXAMPLE`, `TODO` in a published page means an unfinished build. */
const PLACEHOLDER = /EXAMPLE|TODO|YOUR_/i;

/** A top-level redirect to the deployed web app. */
const DEPLOYMENT_URL = /https:\/\/script\.google\.com\/macros\/s\/[^/"']+\/exec/;

/** Escape a value for a Markdown code span / plain text line. */
function escapeMarkdown(value) {
  return String(value).replace(/[`<>]/g, ' ');
}

/**
 * Fail with a message that names the file and the broken rule, so the person
 * running the deploy knows exactly what to regenerate.
 */
function fail(message) {
  throw new Error('build-pages: ' + message);
}

function readIfExists(file, label) {
  if (!fs.existsSync(file)) fail('missing ' + label + ' (' + file + ')');
  return fs.readFileSync(file, 'utf8');
}

/**
 * Validate the committed launcher page and manifest.
 *
 * @param {string} root
 * @returns {{html: string, manifest: object}}
 */
function readLauncher(root) {
  const html = readIfExists(path.join(root, LAUNCHER_DIR, 'index.html'), 'index.html');
  const manifestRaw = readIfExists(path.join(root, LAUNCHER_DIR, 'manifest.json'), 'manifest.json');

  if (PLACEHOLDER.test(html)) {
    fail('index.html contains a placeholder token; regenerate it with npm run app-icon:launcher');
  }
  if (!/rel="apple-touch-icon"/i.test(html)) {
    fail('index.html has no apple-touch-icon link; iOS would not pick up the icon');
  }
  if (/<iframe/i.test(html)) {
    fail('index.html contains an <iframe>; Apps Script refuses a cross-origin frame with HTTP 401, so the page must redirect top-level');
  }
  if (!DEPLOYMENT_URL.test(html)) {
    fail('index.html does not redirect to an https script.google.com /exec deployment');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    fail('manifest.json is not valid JSON: ' + err.message);
  }
  if (!manifest || !Array.isArray(manifest.icons) || !manifest.icons.length) {
    fail('manifest.json declares no icons');
  }
  // Chrome discards a manifest whose start_url/scope are on another origin.
  if (manifest.start_url !== './' || manifest.scope !== './') {
    fail("manifest.json must keep start_url and scope at './' so Pages serves it same-origin");
  }

  return { html: html, manifest: manifest };
}

/**
 * Validate the committed PNGs with the same check the deploy runbook uses.
 *
 * @param {string} root
 */
function assertIcons(root) {
  const report = checkIcons({ assetsDir: path.join(root, 'assets'), sizes: ICON_SIZES });
  if (!report.ok) {
    fail('icons are not publishable: ' + report.problems.join('; '));
  }
  return report;
}

function readme(projectName) {
  const lines = [
    '# ' + escapeMarkdown(projectName) + ' — launcher',
    '',
    'Static GitHub Pages site for the web app home-screen shortcut.',
    '',
    '- Live URL: ' + PAGES_SITE_URL,
    '- Page: `index.html` (keeps the `apple-touch-icon` metadata and redirects',
    '  top-level to the deployed Apps Script web app).',
    '- Icons: `icons/` (180, 192, 512 PNG).',
    '- Manifest: `manifest.json` (`start_url` and `scope` stay `./`, same origin).',
    '',
    'This folder is generated — do not edit it by hand.',
    '',
    '## Rebuild',
    '',
    '```bash',
    'npm run pages:build',
    '```',
    '',
    'Regenerate the launcher first if the deployment URL changed:',
    '',
    '```bash',
    'npm run app-icon:launcher -- --app-url <https /exec URL> --cloudinary <cloud>/<public ID>',
    'npm run pages:build',
    '```',
    '',
    'Then commit and push the folder that Pages serves.',
    ''
  ];
  return lines.join('\n');
}

/** Read the project name for the generated README, falling back safely. */
function projectName(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.name || 'tsn-app');
  } catch (_) {
    return 'tsn-app';
  }
}

/** Directories under the project root that hold tracked files and must never be an output. */
const PROTECTED_DIRS = ['docs', 'assets', 'tests', 'tools', '.git', '.github'];

/**
 * The output folder is deleted before writing, so a mistyped `--out` must be
 * refused *before* anything is removed: `--out .` would wipe the repo and
 * `--out docs` would wipe the runbooks.
 */
function assertSafeOutDir(root, target) {
  const rel = path.relative(root, target);
  const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));

  if (path.resolve(target) === path.resolve(root)) {
    fail('outDir must not be the project root; it is deleted before writing');
  }
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
    fail('outDir points at a source file, not a folder: ' + target);
  }
  if (!inside) return;

  const top = rel.split(path.sep)[0];
  if (PROTECTED_DIRS.some(dir => dir.toLowerCase() === top.toLowerCase())) {
    fail('outDir must not be the source folder ' + top + '; it is deleted before writing');
  }
}

/**
 * Build the publishable site.
 *
 * @param {{root?: string, outDir?: string}} [options]
 * @returns {{outDir: string, files: string[]}}
 */
function buildPagesSite(options) {
  const opts = options || {};
  const root = path.resolve(opts.root || DEFAULTS.root);
  // Absent means "use the default folder"; an explicitly empty value is a
  // mistake worth failing on, because it would otherwise silently build _site.
  const outDir = opts.outDir == null ? DEFAULTS.outDir : String(opts.outDir).trim();

  if (!outDir) fail('outDir is required (pass --out <folder>)');

  const target = path.resolve(outDir);
  assertSafeOutDir(root, target);

  // Validate everything before touching the output folder.
  const launcher = readLauncher(root);
  assertIcons(root);

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, ICON_DIR), { recursive: true });

  fs.writeFileSync(path.join(target, 'index.html'), launcher.html, 'utf8');
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(launcher.manifest, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(target, 'README.md'), readme(projectName(root)), 'utf8');
  // Pages runs Jekyll by default; this keeps files with leading underscores.
  fs.writeFileSync(path.join(target, '.nojekyll'), '', 'utf8');

  ICON_SIZES.forEach(size => {
    const name = 'app-icon-' + size + '.png';
    fs.copyFileSync(path.join(root, 'assets', name), path.join(target, ICON_DIR, name));
  });

  const files = PAGES_SITE_FILES_BEFORE_ICONS
    .concat(ICON_SIZES.map(size => ICON_DIR + '/app-icon-' + size + '.png'));

  return { outDir: target, files: files };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--out') {
      if (!next) throw new Error('--out needs a folder');
      options.outDir = next;
      i++;
    } else if (arg === '--root') {
      if (!next) throw new Error('--root needs a folder');
      options.root = next;
      i++;
    } else {
      throw new Error('unknown argument ' + arg);
    }
  }
  return options;
}

function main(argv) {
  const result = buildPagesSite(parseArgs(argv || []));
  console.log('Wrote ' + result.files.length + ' files to ' + path.relative(ROOT, result.outDir) + ':');
  result.files.forEach(file => console.log('  ' + file));
  console.log('Live URL once Pages is enabled: ' + PAGES_SITE_URL);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPagesSite,
  readLauncher,
  assertIcons,
  parseArgs,
  readme,
  PAGES_SITE_URL,
  PAGES_SITE_FILES_BEFORE_ICONS,
  DEFAULTS,
  ICON_DIR
};
