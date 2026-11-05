'use strict';

/**
 * Cloudinary delivery URLs without the `@cloudinary/url-gen` dependency.
 *
 * The documented React sample uses url-gen to produce:
 *   https://res.cloudinary.com/<cloud>/image/upload/f_auto/q_auto/c_auto,g_auto,h_500,w_500/cld-sample-5
 *
 * This module reproduces exactly that URL shape (minus url-gen's `_a` analytics
 * query, which changes between releases and would break deterministic builds).
 * It is used by the iOS launcher generator and by the deploy-time settings
 * check, both of which run in plain Node.
 *
 * Everything here can end up inside an HTML attribute, so cloud names, public
 * IDs and transformation values are validated before they are interpolated.
 */

const CDN_ORIGIN = 'https://res.cloudinary.com';
const DEFAULT_CLOUD_NAME = 'uxvmo47y';
const ICON_SIZES = [180, 192, 512];

const MAX_DIMENSION = 10000;
const CROP_MODES = [
  'auto', 'fill', 'fill_pad', 'fit', 'limit', 'lfill',
  'thumb', 'crop', 'scale', 'pad', 'lpad', 'mpad', 'mfit'
];

/** Cloud names are alphanumeric with `-`/`_`; never a path or query character. */
const CLOUD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** One public ID segment: letters, digits, dot, dash, underscore. */
const PUBLIC_ID_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** f_/q_ values: `auto` or an alphanumeric token such as `webp` / `80`. */
const TOKEN_RE = /^[A-Za-z0-9]+$/;

/** Gravity: `auto`, `auto:subject`, `north_east`, `center`, ... */
const GRAVITY_RE = /^[a-z][a-z0-9_]*(?::[a-z0-9_]+)*$/;

/** Image extensions stripped when a pasted delivery URL becomes a public ID. */
const IMAGE_EXT_RE = /\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?|svg)$/i;

function fail(what, value) {
  throw new Error(what + ' is invalid: ' + JSON.stringify(value));
}

function assertCloudName(cloudName) {
  if (typeof cloudName !== 'string' || !CLOUD_NAME_RE.test(cloudName.trim())) {
    fail('cloudName', cloudName);
  }
  return cloudName.trim();
}
/**
 * Accept `folder/name`, `folder/name.ext`, never an absolute path, a `..`
 * segment, an empty segment, a trailing slash or a percent-escape.
 *
 * @returns {boolean} true when the value can be interpolated into a URL path.
 */
function isSafePublicId(publicId) {
  if (typeof publicId !== 'string') return false;
  const value = publicId.trim();
  if (!value) return false;
  if (value.charAt(0) === '/' || value.charAt(value.length - 1) === '/') return false;
  if (value.indexOf('//') !== -1) return false;
  if (value.indexOf('%') !== -1) return false;

  const segments = value.split('/');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') return false;
    if (!PUBLIC_ID_SEGMENT_RE.test(segment)) return false;
  }
  return true;
}

function assertPublicId(publicId) {
  if (typeof publicId !== 'string') fail('publicId', publicId);
  if (!isSafePublicId(publicId)) fail('publicId', publicId);
  return publicId.trim();
}

function assertDimension(what, value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_DIMENSION) {
    fail(what, value);
  }
  return value;
}

function assertToken(what, value) {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) fail(what, value);
  return value;
}

function assertGravity(gravity) {
  if (typeof gravity !== 'string' || !GRAVITY_RE.test(gravity)) fail('gravity', gravity);
  return gravity;
}

/**
 * Build a crop qualifier object, mirroring `auto().width(w).height(h).gravity(g)`.
 *
 * @param {{width: number, height: number, gravity?: string, mode?: string}} options
 */
function autoCrop(options) {
  const opts = options || {};
  return crop(opts.mode || 'auto', opts.width, opts.height, opts.gravity || 'auto');
}

function crop(mode, width, height, gravity) {
  if (CROP_MODES.indexOf(mode) === -1) fail('crop mode', mode);
  const out = {
    mode: mode,
    width: assertDimension('width', width),
    height: assertDimension('height', height)
  };
  if (gravity !== undefined && gravity !== null && gravity !== '') {
    out.gravity = assertGravity(gravity);
  }
  return out;
}

/** Validate an already-built crop object (width/height may arrive untyped). */
function assertCrop(qualifier) {
  if (qualifier === undefined || qualifier === null) return null;
  if (typeof qualifier !== 'object') fail('crop', qualifier);
  return crop(qualifier.mode, qualifier.width, qualifier.height, qualifier.gravity);
}

/** `c_auto,g_auto,h_500,w_500` — alphabetical, the order url-gen emits. */
function cropSegment(qualifier) {
  if (!qualifier) return '';
  const parts = ['c_' + qualifier.mode];
  if (qualifier.gravity) parts.push('g_' + qualifier.gravity);
  parts.push('h_' + qualifier.height, 'w_' + qualifier.width);
  return parts.join(',');
}

/**
 * Split an existing Cloudinary delivery URL into cloud name and public ID.
 *
 * Admins copy the whole URL from the Media Library, for example:
 *   https://res.cloudinary.com/uxvmo47y/image/upload/c_auto,h_180,w_180/logo.jpg
 * Transformation, version and the file extension are not part of a public ID,
 * so they are dropped before the icon set is rebuilt. Returns `null` when the
 * value is not a Cloudinary image delivery URL.
 *
 * @param {string} value
 * @returns {{cloudName: string, publicId: string}|null}
 */
function parseDeliveryUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return null;
  const m = /^https:\/\/res\.cloudinary\.com\/([A-Za-z0-9][A-Za-z0-9_-]*)\/image\/upload\/(.+)$/i.exec(raw);
  if (!m) return null;

  const segments = m[2].split('/');
  while (segments.length > 1 && /^(v\d+|[a-z]{1,4}_[^/]+)$/i.test(segments[0])) segments.shift();

  const stripped = segments.join('/').replace(IMAGE_EXT_RE, '');
  if (!isSafePublicId(stripped)) return null;
  return { cloudName: m[1], publicId: stripped };
}

/**
 * @param {{
 *   cloudName?: string,
 *   publicId: string,
 *   format?: string,
 *   quality?: string,
 *   crop?: {mode: string, width: number, height: number, gravity?: string},
 *   version?: number
 * }} options
 * @returns {string} an https Cloudinary delivery URL
 */
function imageUrl(options) {
  const opts = options || {};
  const hasCloud = Object.prototype.hasOwnProperty.call(opts, 'cloudName');
  const cloudName = assertCloudName(hasCloud ? opts.cloudName : DEFAULT_CLOUD_NAME);
  const publicId = assertPublicId(opts.publicId);

  const segments = [];
  const format = opts.format === undefined ? 'auto' : assertToken('format', opts.format);
  const quality = opts.quality === undefined ? 'auto' : assertToken('quality', opts.quality);
  segments.push('f_' + format);
  segments.push('q_' + quality);

  const cropPart = cropSegment(assertCrop(opts.crop));
  if (cropPart) segments.push(cropPart);

  if (opts.version !== undefined && opts.version !== null) {
    if (!Number.isInteger(opts.version) || opts.version <= 0) fail('version', opts.version);
    segments.push('v' + opts.version);
  }
  segments.push(publicId);

  return CDN_ORIGIN + '/' + cloudName + '/image/upload/' + segments.join('/');
}

/**
 * Square PNG icon URL — iOS only accepts PNG for `apple-touch-icon`.
 *
 * @param {{cloudName?: string, publicId: string, size?: number, version?: number}} options
 */
function iconUrl(options) {
  const opts = options || {};
  const size = assertDimension('size', opts.size === undefined ? 180 : opts.size);
  const request = {
    publicId: opts.publicId,
    format: 'png',
    quality: 'auto',
    crop: crop('fill', size, size),
    version: opts.version
  };
  if (opts.cloudName !== undefined) request.cloudName = opts.cloudName;
  return imageUrl(request);
}

/**
 * @param {{cloudName?: string, publicId: string, sizes?: number[], version?: number}} options
 * @returns {Array<{size: number, src: string, purpose: string}>}
 */
function cloudinaryIconSet(options) {
  const opts = options || {};
  const sizes = opts.sizes === undefined ? ICON_SIZES : opts.sizes;
  if (!Array.isArray(sizes) || !sizes.length) fail('size list', sizes);
  sizes.forEach(size => {
    if (!Number.isInteger(size) || size <= 0 || size > MAX_DIMENSION) fail('size', size);
  });

  return sizes.map(size => ({
    size: size,
    src: iconUrl({
      cloudName: opts.cloudName,
      publicId: opts.publicId,
      size: size,
      version: opts.version
    }),
    purpose: size === 512 ? 'any maskable' : 'any'
  }));
}

module.exports = {
  imageUrl,
  iconUrl,
  cloudinaryIconSet,
  autoCrop,
  parseDeliveryUrl,
  CDN_ORIGIN,
  DEFAULT_CLOUD_NAME,
  ICON_SIZES,
  MAX_DIMENSION,
  CROP_MODES
};

/* ------------------------------- CLI ------------------------------- */

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--public-id') {
      if (!next) throw new Error('--public-id needs a value');
      options.publicId = next;
      i++;
    } else if (arg === '--cloud-name') {
      if (!next) throw new Error('--cloud-name needs a value');
      options.cloudName = next;
      i++;
    } else if (arg === '--icons') {
      options.icons = true;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error('unknown argument ' + arg);
    }
  }
  if (!options.publicId) throw new Error('publicId is required; pass --public-id <cloudinary public ID>');
  return options;
}

function main(argv) {
  const options = parseArgs(argv || []);
  const request = { publicId: options.publicId };
  if (options.cloudName !== undefined) request.cloudName = options.cloudName;

  if (options.icons) {
    const set = cloudinaryIconSet(request);
    if (options.json) {
      process.stdout.write(JSON.stringify(set) + '\n');
      return;
    }
    set.forEach(icon => console.log(icon.size + 'x' + icon.size + '  ' + icon.src));
    return;
  }

  const url = imageUrl(Object.assign({}, request, { crop: autoCrop({ width: 500, height: 500 }) }));
  if (options.json) {
    process.stdout.write(JSON.stringify({ url: url }) + '\n');
    return;
  }
  console.log(url);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error('cloudinary-url failed: ' + err.message);
    process.exitCode = 1;
  }
}

