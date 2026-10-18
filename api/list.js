import { list } from '@vercel/blob';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'x-backup-key');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Gate the file listing behind the password when one is configured.
  // Delete this block if you want /api/list to stay public.
  const expected = process.env.BACKUP_PASSWORD;
  if (expected) {
    const provided =
      req.headers['x-backup-key'] ||
      (typeof req.query.key === 'string' ? req.query.key : '');
    if (provided !== expected) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const page = await list({ limit: 20 });
  return res.status(200).json({
    blobCount: page.blobs.length,
    firstPathnames: page.blobs.map((b) => b.pathname),
    hasToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    tokenPrefix: process.env.BLOB_READ_WRITE_TOKEN?.slice(0, 12) ?? null,
    blobStoreId: process.env.BLOB_STORE_ID ?? null,
    node: process.version,
  });
}
