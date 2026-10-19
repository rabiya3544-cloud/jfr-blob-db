// api/fetch-css-bundle.js
import JSZip from 'jszip';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };
export const maxDuration = 60;

const FETCH_TIMEOUT_MS   = 20000;
const CONCURRENCY        = 24;
const PER_ASSET_LIMIT    = 5 * 1024 * 1024;      // 5 MB per file
const DEFAULT_MAX_ASSETS = 300;
const DEFAULT_MAX_BYTES  = 20 * 1024 * 1024;     // 20 MB total
const DEFAULT_MAX_DEPTH  = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; CssBundleFetcher/1.0; +https://jfr-blob-db.vercel.app)';

/* ---------- misc helpers ---------- */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-Css-Count, X-Asset-Count, X-Total-Bytes');
}

function sanitizeName(name, fallback = 'file') {
  let s = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^[._-]+/, '');
  if (!s) s = fallback;
  if (s.length > 100) {
    const dot = s.lastIndexOf('.');
    s = (dot > 0 && s.length - dot < 12)
      ? s.slice(0, 100 - (s.length - dot)) + s.slice(dot)
      : s.slice(0, 100);
  }
  return s;
}

function deriveFileName(absUrl, fallback = 'file') {
  try {
    const u = new URL(absUrl);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (!last) return fallback;
    return sanitizeName(last, fallback);
  } catch { return fallback; }
}

function uniqueName(used, base) {
  if (!used.has(base)) { used.add(base); return base; }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext  = dot > 0 ? base.slice(dot) : '';
  let i = 1, cand;
  do { cand = `${stem}-${i}${ext}`; i++; } while (used.has(cand));
  used.add(cand);
  return cand;
}

function ensureCssExt(name) {
  return /\.css$/i.test(name) ? name : name.replace(/\.[a-z0-9]{1,8}$/i, '') + '.css';
}

function extFromContentType(ct) {
  if (!ct) return '';
  const t = ct.toLowerCase().split(';')[0].trim();
  const map = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/webp': '.webp',
    'image/avif': '.avif', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
    'image/bmp': '.bmp', 'image/tiff': '.tiff',
    'font/woff': '.woff', 'font/woff2': '.woff2', 'font/ttf': '.ttf', 'font/otf': '.otf',
    'application/font-woff': '.woff', 'application/font-woff2': '.woff2',
    'application/x-font-ttf': '.ttf', 'application/x-font-otf': '.otf',
    'application/vnd.ms-fontobject': '.eot',
    'application/json': '.json', 'text/plain': '.txt', 'text/html': '.html',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3',
  };
  return map[t] || '';
}

function deriveAssetName(absUrl, contentType) {
  let name = deriveFileName(absUrl, 'asset');
  if (!/\.[a-z0-9]{1,8}$/i.test(name)) {
    const ext = extFromContentType(contentType);
    if (ext) name += ext;
  }
  return name;
}

function isCssContentType(ct, url) {
  const t = (ct || '').toLowerCase().split(';')[0].trim();
  if (t === 'text/css' || t === 'text/x-css') return true;
  if (t && t !== 'text/plain' && t !== 'application/octet-stream' && t !== 'binary/octet-stream') return false;
  try { return /\.css$/i.test(new URL(url).pathname); } catch { return false; }
}

/* ---------- SSRF guard (basic) ---------- */

function isBlockedHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10
