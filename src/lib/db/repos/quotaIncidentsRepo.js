import { getAdapter } from "../driver.js";

// Repo insiden kuota & error untuk ide #4 "Fill-first sadar kuota".
// Tabel quota_incidents dideklarasikan di src/lib/db/schema.js TABLES.
// Satu entri per (connectionId, model); ukuran per entri ±100–200 byte.
// Catatan kontrak: threshold hanya mengatur VISIBILITAS dashboard — repo ini
// tidak memblokir/melewati koneksi apa pun; worker runtime yang memanggil
// upsertIncident/removeIncident sesuai ambang kegagalan beruntun.

function rowToIncident(row) {
  return {
    connectionId: row.connection_id,
    model: row.model,
    provider: row.provider,
    errorClass: row.error_class,
    lastError: row.last_error,
    lastStatus: row.last_status,
    failureCount: row.failure_count,
    firstSeen: row.first_seen,
    updatedAt: row.updated_at,
  };
}

// Catat/refresh satu insiden: insert bila (connectionId, model) belum ada
// (first_seen diisi saat itu), update bila sudah ada (updated_at selalu now).
// model dinormalisasi ke string ("" = tidak terikat satu model spesifik).
export async function upsertIncident({ connectionId, model, provider, errorClass, lastError, lastStatus, failureCount }) {
  if (!connectionId) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const modelKey = model || "";
  db.transaction(() => {
    db.run(
      `INSERT INTO quota_incidents (connection_id, model, provider, error_class, last_error, last_status, failure_count, first_seen, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, model) DO UPDATE SET
         provider = excluded.provider,
         error_class = excluded.error_class,
         last_error = excluded.last_error,
         last_status = excluded.last_status,
         failure_count = excluded.failure_count,
         updated_at = excluded.updated_at`,
      [
        connectionId,
        modelKey,
        provider || null,
        errorClass || null,
        lastError || null,
        lastStatus ?? null,
        failureCount ?? 1,
        now,
        now,
      ]
    );
  });
}

// Hapus satu insiden; no-op bila (connectionId, model) tidak ada.
export async function removeIncident(connectionId, model) {
  if (!connectionId) return;
  const db = await getAdapter();
  db.run(`DELETE FROM quota_incidents WHERE connection_id = ? AND model = ?`, [connectionId, model || ""]);
}

// Hapus SEMUA insiden milik satu koneksi — dipakai saat koneksi/API key
// dihapus agar dashboard tidak menampilkan insiden yatim.
export async function removeIncidentsByConnection(connectionId) {
  if (!connectionId) return 0;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM quota_incidents WHERE connection_id = ?`, [connectionId]);
  return res?.changes || 0;
}

// Daftar semua insiden, terbaru dulu (updatedAt desc).
export async function listIncidents() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT connection_id, model, provider, error_class, last_error, last_status, failure_count, first_seen, updated_at
     FROM quota_incidents ORDER BY updated_at DESC`
  );
  return rows.map(rowToIncident);
}

// Breakdown insiden per kelas error untuk usage analytics (GET /api/usage/stats).
// Bentuk: { [errorClass]: { incidents, failures } } — incidents = jumlah
// pasangan (connectionId, model) dalam kelas ini; failures = total
// failure_count (deret kegagalan beruntun) kelas ini.
// Ini snapshot status terkini (entri dihapus saat koneksi pulih), bukan
// agregat historis — jadi tidak terikat periode waktu pemanggil.
export async function getErrorBreakdown() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT error_class, COUNT(*) AS incidents, COALESCE(SUM(failure_count), 0) AS failures
     FROM quota_incidents GROUP BY error_class`
  );
  const out = {};
  for (const r of rows) {
    out[r.error_class || "unknown"] = {
      incidents: Number(r.incidents) || 0,
      failures: Number(r.failures) || 0,
    };
  }
  return out;
}
