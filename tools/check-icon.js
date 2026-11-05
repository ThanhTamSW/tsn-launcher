'use strict';

/**
 * Validate the committed app icons before a deploy.
 *
 * The icons are binary assets that `.claspignore` excludes, so a broken file
 * would only surface on a phone home screen — the worst place to notice. This
 * check is cheap and runs in CI/locally:
 *   - the three expected files exist,
 *   - each is a real PNG,
 *   - each has exactly the dimensions its name promises,
 *   - each stays small enough to be a sane web payload.
 *
 * Usage:
 *   node tools/check-icon.js
 *   node tools/check-icon.js --assets <dir>   # for tests
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ICON_SIZES = [180, 192, 512];
const MAX_BYTES = 300 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @param {{assetsDir?: string, sizes?: number[]}} [options]
 * @returns {{ok: boolean, files: Array<{size: number, path: string, width: number, height: number, bytes: number}>, problems: string[]}}
 */
function checkIcons(options) {
  const opts = options || {};
  const assetsDir = opts.assetsDir || path.join(ROOT, 'assets');
  const sizes = (opts.sizes || ICON_SIZES).slice();

  const files = [];
  const problems = [];

  for (const size of sizes) {
    const name = 'app-icon-' + size + '.png';
    const file = path.join(assetsDir, name);
    if (!fs.existsSync(file)) {
      problems.push('missing icon: ' + name);
      continue;
    }
    const buf = fs.readFileSync(file);
    const dims = pngDimensions(buf);
    if (!dims) {
      problems.push(name + ' is not a valid PNG');
      continue;
    }
    if (dims.width !== size || dims.height !== size) {
      problems.push(name + ' must be ' + size + 'x' + size + ', got ' + dims.width + 'x' + dims.height);
      continue;
    }
    if (buf.length > MAX_BYTES) {
      problems.push(name + ' is too large: ' + buf.length + ' bytes (max ' + MAX_BYTES + ')');
      continue;
    }
    files.push({ size: size, path: file, width: dims.width, height: dims.height, bytes: buf.length });
  }

  return { ok: problems.length === 0, files: files, problems: problems };
}

/** Return {width, height} for a real PNG, or null when it is not a PNG. */
function pngDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buf.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--assets') {
      const next = argv[i + 1];
      if (!next) throw new Error('--assets needs a directory');
      options.assetsDir = path.resolve(next);
      i++;
    } else {
      throw new Error('unknown argument ' + argv[i]);
    }
  }
  return options;
}

function main(argv) {
  const report = checkIcons(parseArgs(argv || []));
  if (report.ok) {
    report.files.forEach(f => {
      console.log(f.path.split(/[\\/]/).pop() + ' — ' + f.width + 'x' + f.height + ', ' + f.bytes + ' bytes');
    });
    console.log('app-icon:check — all ' + report.files.length + ' icons are valid.');
    return;
  }
  report.problems.forEach(p => console.error('app-icon:check — ' + p));
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error('app-icon:check failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = { checkIcons, pngDimensions, parseArgs, ICON_SIZES, MAX_BYTES };
