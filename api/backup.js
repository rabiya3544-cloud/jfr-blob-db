import { list } from '@vercel/blob';
import archiver from 'archiver';
import path from 'node:path';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function safeRelative(p) {
  const n = path.posix.normalize(p.replace(/^\/+/, ''));
  if (n === '..' || n.startsWith('../') || path.isAbsolute(n)) {
    throw new Error(`Unsafe pathname: ${p}`);
  }
  return n;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return; // same-origin, curl, server-to-server — nothing to do

  // If ALLOWED_ORIGINS is unset, fall back to "any" — useful for local testing.
  // Set it in production; that's the whole point.
  const ok =
    ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin);
  if (!ok) return;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-File-Count, Content-Disposition, Content-Length'
  );
}

export default async function handler(req, res) {
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-backup-key, content-type');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // Reject early if the origin is not allowed — clearer than a CORS failure
  if (req.headers.origin && ALLOWED_ORIGINS.length > 0 &&
      !ALLOWED_ORIGINS.includes(req.headers.origin)) {
    return res.status(403).json({ error: 'origin not allowed' });
  }

  const prefix =
    typeof req.query.prefix === 'string' ? req.query.prefix : '';

  const expected = process.env.BACKUP_PASSWORD;
  if (expected) {
    // Header first, query fallback (so curl and the old HTML still work)
    const provided =
      req.headers['x-backup-key'] ||
      (typeof req.query.key === 'string' ? req.query.key : '');
    if (provided !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const archive = archiver('zip', { zlib: { level: 6 } });
  const chunks = [];
  archive.on('data', (c) => chunks.push(c));

  const finished = new Promise((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
    archive.on('warning', (e) => {
      if (e.code !== 'ENOENT') reject(e);
    });
  });

  try {
    let cursor;
    let count = 0;
    do {
      const page = await list({ cursor, limit: 1000, prefix });
      for (const blob of page.blobs) {
        const rel = safeRelative(blob.pathname);
        const r = await fetch(blob.url);
        if (!r.ok || !r.body) {
          throw new Error(`fetch ${rel} failed: ${r.status} ${r.statusText}`);
        }
        archive.append(Buffer.from(await r.arrayBuffer()), { name: rel });
        count++;
      }
      cursor = page.cursor;
    } while (cursor);

    await archive.finalize();
    await finished;

    const zip = Buffer.concat(chunks);
    console.log(`✓ built ${count} files, ${zip.length} bytes`);

    const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `backup-${date}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(zip.length));
    res.setHeader('X-File-Count', String(count));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).end(zip);
  } catch (err) {
    console.error('backup failed:', err);
    return res.status(500).json({ error: err.message });
  }
}
