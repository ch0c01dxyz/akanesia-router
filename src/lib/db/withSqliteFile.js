/**
 * Buka file DB SQLite sekali pakai via node:sqlite (built-in Node >= 22),
 * jalankan fn(db), lalu tutup otomatis — bahkan bila fn melempar.
 * Untuk query ad-hoc ke file DB eksternal (bukan DB utama app).
 *
 * @param {string} dbPath
 * @param {(db: import("node:sqlite").DatabaseSync) => T} fn
 * @param {{ readOnly?: boolean }} [opts]
 */
export async function withSqliteFile(dbPath, fn, opts = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: opts.readOnly !== false });
  try {
    return await fn(db);
  } finally {
    try { db.close(); } catch {}
  }
}
