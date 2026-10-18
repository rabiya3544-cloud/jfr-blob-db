export default async function handler(req, res) {
  return res.status(200).json({
    hasToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    tokenPrefix: process.env.BLOB_READ_WRITE_TOKEN?.slice(0, 12) ?? null,
    hasPasswordGate: Boolean(process.env.BACKUP_PASSWORD),
    blobStoreId: process.env.BLOB_STORE_ID ?? null,
    node: process.version,
  });
}
