function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  return res.status(200).json({
    hasToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    tokenPrefix: process.env.BLOB_READ_WRITE_TOKEN?.slice(0, 12) ?? null,
    hasPasswordGate: Boolean(process.env.BACKUP_PASSWORD),
    blobStoreId: process.env.BLOB_STORE_ID ?? null,
    node: process.version,
  });
}
