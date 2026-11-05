'use strict';

/**
 * Generate a static launcher page for home-screen icons.
 *
 * The launcher CANNOT embed the web app in an iframe. Apps Script answers a
 * cross-origin framed request with HTTP 401 ("Máy chủ không thể xử lý yêu cầu
 * này vì yêu cầu không hợp lệ"): `XFrameOptionsMode.ALLOWALL` allows framing,
 * but an iframe cannot carry the Google login session, so the deployed web app
 * refuses to render. The page therefore keeps the icon metadata in <head>
 * (iOS/Android snapshot it when the shortcut is created) and, only when it
 * already runs as an installed app, navigates the TOP-LEVEL window to the app
 * URL, where login works normally.
 *
 * The guard matters: the OS reads `apple-touch-icon` from whatever document is
 * current when the user taps "Add to Home Screen". A normal browser tab must
 * therefore stay on this page. An unconditional redirect replaces it with
 * `/exec` first, and `/exec`'s Google-generated <head> carries no icon
 * metadata, so the shortcut would get Google's default icon.
 *
 * Icons come from exactly one source:
 *   - `--icon-base <https folder>` for already-hosted PNGs (GitHub Pages), or
 *   - `--cloudinary <cloud>/<public id>` for Cloudinary delivery URLs, which
 *     match what `@cloudinary/url-gen` emits.
 *
 * Every input is admin-supplied, so URLs and IDs are validated before being
 * interpolated into attributes.
 *
 * Usage:
 *   node tools/build-launcher.js \
 *     --app-url https://script.google.com/macros/s/<ID>/exec \
 *     --icon-base https://<user>.github.io/<repo>/icons \
 *     --out docs/launcher
 *
 *   node tools/build-launcher.js \
 *     --app-url https://script.google.com/macros/s/<ID>/exec \
 *     --cloudinary uxvmo47y/tsn/app-icon \
 *     --out docs/launcher
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  cloudinaryIconSet,
  parseDeliveryUrl,
  DEFAULT_CLOUD_NAME,
  ICON_SIZES
} = require('./cloudinary-url');

const ROOT = path.join(__dirname, '..');

const THEME_COLOR = '#1e3a8a';
const APP_TITLE = 'Quản lý phòng tập';
const APP_SUBTITLE = 'Ứng dụng quản lý khách hàng, hợp đồng và buổi tập.';
const INSTALL_HINT = 'Trên điện thoại: bấm Chia sẻ → “Thêm vào màn hình chính” để cài như ứng dụng.';

/**
 * iOS reads one `apple-touch-icon` and picks the closest declared size, so the
 * launcher declares the three common device sizes instead of only 180: iPad
 * (152), iPad Pro (167) and iPhone (180). The web app manifest keeps the PWA
 * sizes; these links are Apple-only.
 */
const APPLE_TOUCH_SIZES = [152, 167, 180];

const DEFAULTS = {
  appUrl: '',
  iconBase: '',
  // Documented sample cloud; a build only uses Cloudinary when asked to.
  cloudinary: { cloudName: DEFAULT_CLOUD_NAME, publicId: '' },
  outDir: path.join(ROOT, 'docs', 'launcher')
};

/** Whitespace, quotes, angle brackets and backslash would break an attribute. */
const UNSAFE = /[\s"'<>\\]/;

function assertClean(value, what) {
  if (UNSAFE.test(value)) {
    throw new Error(what + ' contains an invalid character');
  }
}

/**
 * @returns {string} the URL unchanged (it is already clean and https).
 */
function validateAppUrl(value) {
  const url = String(value == null ? '' : value).trim();
  if (!url) throw new Error('appUrl is empty; pass the deployed /exec https URL');
  if (!/^https:\/\//i.test(url)) throw new Error('appUrl must start with https:// (got ' + url.slice(0, 16) + ')');
  assertClean(url, 'appUrl');
  if (!/^https:\/\/[^/?#]+/.test(url)) throw new Error('appUrl is an invalid URL (no host)');
  return url;
}

/**
 * @returns {string} the base URL with exactly one trailing slash.
 */
function validateIconBase(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) throw new Error('iconBase is empty; pass the https folder that hosts the PNGs');
  if (!/^https:\/\//i.test(raw)) throw new Error('iconBase must start with https:// (got ' + raw.slice(0, 16) + ')');
  assertClean(raw, 'iconBase');
  if (/[?#]/.test(raw)) throw new Error('iconBase must be a plain folder URL without ? or #');
  if (!/^https:\/\/[^/?#]+/.test(raw)) throw new Error('iconBase is an invalid URL (no host)');
  return raw.replace(/\/+$/, '') + '/';
}

/** Escape a value for an HTML attribute or text node. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape a value for a double-quoted JavaScript string literal. */
function escapeJsString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * The guarded redirect.
 *
 * `location.replace` runs only when the page is already an installed app
 * (iOS `navigator.standalone`, or a PWA matchMedia display-mode). In a normal
 * browser tab the page stays put, because that is the moment the OS reads
 * `apple-touch-icon` for "Add to Home Screen".
 */
function redirectScript(appUrl) {
  return [
    '<script>',
    '(function(){',
    '  var standalone = false;',
    '  try {',
    '    standalone = (window.navigator.standalone === true) ||',
    "      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);",
    '  } catch (e) {}',
    '  if (standalone) {',
    '    try { location.replace("' + escapeJsString(appUrl) + '"); } catch (e) {}',
    '  }',
    '})();',
    '</script>'
  ].join('\n');
}

function manifestFor(appUrl, icons) {
  // `start_url` and `scope` MUST be same-origin with the page serving the
  // manifest, otherwise Chrome discards the manifest. The page redirects to
  // `appUrl` itself, so the deployment URL no longer belongs here; the
  // parameter stays for backwards compatibility with callers.
  //
  // Apple-only sizes (152/167) are not PWA icon sizes; the manifest keeps the
  // canonical set so Android installs pick a real asset.
  const manifestIcons = ICON_SIZES
    .map(size => icons.find(icon => icon.size === size))
    .filter(Boolean);

  return {
    name: APP_TITLE,
    short_name: 'Phòng tập',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: THEME_COLOR,
    icons: manifestIcons.map(icon => {
      const entry = { src: icon.src, sizes: icon.size + 'x' + icon.size, type: 'image/png' };
      if (icon.size === 512) entry.purpose = 'any maskable';
      return entry;
    })
  };
}

/**
 * `apple-touch-icon` links for the sizes this icon set actually carries.
 *
 * iOS silently downscales when a size is missing, so a file-hosted set that
 * only ships 180 stays a single link; a Cloudinary set carries all three.
 */
function appleTouchLinks(icons) {
  return APPLE_TOUCH_SIZES
    .map(size => icons.find(icon => icon.size === size))
    .filter(Boolean)
    .map(icon => '<link rel="apple-touch-icon" sizes="' + icon.size + 'x' + icon.size +
      '" href="' + escapeHtml(icon.src) + '">');
}

function launcherHtml(appUrl, icons) {
  const icon192 = icons.find(i => i.size === 192);
  if (!icon192) throw new Error('the icon set must include 192');
  const appleLinks = appleTouchLinks(icons);
  if (!appleLinks.length) throw new Error('the icon set must include an apple-touch-icon size');

  const escapedAppUrl = escapeHtml(appUrl);
  const iconSrc = escapeHtml(icon192.src);

  return [
    '<!DOCTYPE html>',
    '<html lang="vi">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>' + APP_TITLE + '</title>',
    '<meta name="theme-color" content="' + THEME_COLOR + '">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<link rel="manifest" href="manifest.json">'
  ].concat(appleLinks).concat([
    '<link rel="icon" type="image/png" sizes="192x192" href="' + iconSrc + '">',
    '<noscript><meta http-equiv="refresh" content="0; url=' + escapedAppUrl + '"></noscript>',
    '<style>',
    'html,body{margin:0;height:100%;overflow:hidden}',
    'body{display:flex;align-items:center;justify-content:center;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    'background:linear-gradient(120deg,#1e3a8a,#2563eb);color:#fff}',
    '.brand{display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;padding:24px}',
    '.brand img{display:block;width:96px;height:96px;border-radius:20px;background:#fff}',
    '.brand h1{margin:0;font-size:20px;font-weight:600;line-height:1.3}',
    '.brand p{margin:0;font-size:15px;opacity:.85}',
    '.brand a{margin-top:8px;padding:12px 24px;border-radius:999px;background:#fff;color:#1e3a8a;',
    'font-weight:600;text-decoration:none}',
    '.brand .note{margin:0;font-size:12px;line-height:1.5;opacity:.7;max-width:320px}',
    '</style>',
    '</head>',
    '<body>',
    '<main class="brand">',
    '<img src="' + iconSrc + '" width="96" height="96" alt="' + APP_TITLE + '">',
    '<h1>' + APP_TITLE + '</h1>',
    '<p>' + APP_SUBTITLE + '</p>',
    '<a href="' + escapedAppUrl + '">Mở ứng dụng</a>',
    '<p class="note">' + INSTALL_HINT + '</p>',
    '</main>',
    redirectScript(appUrl),
    '</body>',
    '</html>',
    ''
  ]).join('\n');
}

/**
 * Every size a Cloudinary launcher needs: the PWA manifest sizes plus the
 * Apple-only sizes, deduplicated and ascending.
 */
const LAUNCHER_SIZES = Array.from(new Set(ICON_SIZES.concat(APPLE_TOUCH_SIZES)))
  .sort((a, b) => a - b);

/** File-name icons from an already-hosted folder. */
function fileIconSet(iconBase) {
  return ICON_SIZES.map(size => ({ size: size, src: iconBase + 'app-icon-' + size + '.png' }));
}

/**
 * Resolve the single icon source for this launcher.
 *
 * Both `iconBase` and a configured `cloudinary.publicId` would produce a page
 * whose icons live on different hosts, which cannot be reproduced or cleaned
 * up reliably, so exactly one is allowed.
 *
 * @param {{iconBase?: string, cloudinary?: {cloudName?: string, publicId?: string}}} opts
 * @returns {Array<{size: number, src: string}>}
 */
function resolveIcons(opts) {
  const cloud = opts.cloudinary || {};
  const hasCloudinary = !!String(cloud.publicId == null ? '' : cloud.publicId).trim();
  const hasBase = !!String(opts.iconBase == null ? '' : opts.iconBase).trim();

  if (hasCloudinary && hasBase) {
    throw new Error('pass exactly one icon source: --icon-base or --cloudinary, not both');
  }
  if (hasCloudinary) {
    return cloudinaryIconSet({
      cloudName: cloud.cloudName,
      publicId: cloud.publicId,
      sizes: LAUNCHER_SIZES
    }).map(icon => ({ size: icon.size, src: icon.src }));
  }
  if (hasBase) {
    return fileIconSet(validateIconBase(opts.iconBase));
  }
  throw new Error('no icon source; pass --icon-base <https folder> or --cloudinary <cloud>/<public ID>');
}

/**
 * @param {{appUrl: string, iconBase?: string, cloudinary?: {cloudName?: string, publicId?: string}, outDir?: string}} options
 * @returns {{htmlPath: string, manifestPath: string}}
 */
function buildLauncher(options) {
  const opts = Object.assign({}, DEFAULTS, options);
  const appUrl = validateAppUrl(opts.appUrl);
  const icons = resolveIcons(opts);
  const outDir = opts.outDir || DEFAULTS.outDir;

  fs.mkdirSync(outDir, { recursive: true });

  const htmlPath = path.join(outDir, 'index.html');
  const manifestPath = path.join(outDir, 'manifest.json');

  fs.writeFileSync(htmlPath, launcherHtml(appUrl, icons), 'utf8');
  fs.writeFileSync(manifestPath, JSON.stringify(manifestFor(appUrl, icons), null, 2) + '\n', 'utf8');

  return { htmlPath: htmlPath, manifestPath: manifestPath };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--app-url') {
      if (!next) throw new Error('--app-url needs a value');
      options.appUrl = next;
      i++;
    } else if (arg === '--icon-base') {
      if (!next) throw new Error('--icon-base needs a value');
      options.iconBase = next;
      i++;
    } else if (arg === '--cloudinary') {
      if (!next) throw new Error('--cloudinary needs <cloud name>/<public ID>');
      options.cloudinary = parseCloudinary(next);
      i++;
    } else if (arg === '--out') {
      if (!next) throw new Error('--out needs a path');
      options.outDir = path.resolve(next);
      i++;
    } else {
      throw new Error('unknown argument ' + arg);
    }
  }
  return options;
}

/**
 * `uxvmo47y/tsn/app-icon` -> { cloudName: 'uxvmo47y', publicId: 'tsn/app-icon' }.
 * The full Cloudinary URL is accepted too, because that is what an admin copies
 * from the Media Library. Any leading version (`v1`) or transformation segments
 * (`f_png`, `c_fill,h_180,w_180`) are dropped, since only the public ID matters
 * for the icon set this tool generates.
 */
function parseCloudinary(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) throw new Error('--cloudinary needs <cloud name>/<public ID>');

  const delivery = parseDeliveryUrl(raw);
  if (delivery) return delivery;

  const slash = raw.indexOf('/');
  if (slash <= 0 || slash === raw.length - 1) {
    throw new Error('--cloudinary must look like <cloud name>/<public ID> (got ' + raw.slice(0, 24) + ')');
  }
  return { cloudName: raw.slice(0, slash), publicId: raw.slice(slash + 1) };
}

function main(argv) {
  const options = parseArgs(argv || []);
  const result = buildLauncher(options);
  console.log('Wrote ' + path.relative(ROOT, result.htmlPath) + ' and ' +
    path.relative(ROOT, result.manifestPath) + '.');
  console.log('Host this folder on https and open index.html on the phone to add the shortcut.');
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error('build-launcher failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildLauncher, launcherHtml, redirectScript, manifestFor, resolveIcons, appleTouchLinks,
  validateAppUrl, validateIconBase, parseCloudinary,
  ICON_SIZES, APPLE_TOUCH_SIZES, LAUNCHER_SIZES, DEFAULTS, APP_TITLE, APP_SUBTITLE,
  INSTALL_HINT, THEME_COLOR
};
