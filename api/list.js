import { list } from '@vercel/blob';

export default async function handler(req, res) {
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
