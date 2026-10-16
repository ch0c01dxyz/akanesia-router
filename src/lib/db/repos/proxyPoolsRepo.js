import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

export async function getProxyPoolById(id) {
  const db = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}

// --- Health monitor -----------------------------------------------------------

/** Jumlah kegagalan beruntun sebelum pool dinonaktifkan otomatis. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Catat kegagalan health check. Counter +1; capai MAX_CONSECUTIVE_FAILURES
 * → isActive=false + disabledReason="auto". Mengembalikan pool ter-update.
 */
export async function recordProxyFailure(id, error) {
  const db = await getAdapter();
  let result = null;
  const now = new Date().toISOString();
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const pool = rowToPool(row);
    const failures = (pool.consecutiveFailures || 0) + 1;
    const patch = {
      consecutiveFailures: failures,
      testStatus: "error",
      lastTestedAt: now,
      lastError: error || null,
    };
    if (failures >= MAX_CONSECUTIVE_FAILURES && pool.isActive !== false) {
      patch.isActive = false;
      patch.disabledAt = now;
      patch.disabledReason = "auto";
    }
    const merged = { ...pool, ...patch, updatedAt: now };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

/** Catat health check sukses: reset counter kegagalan. */
export async function recordProxySuccess(id) {
  return updateProxyPool(id, {
    consecutiveFailures: 0,
    disabledReason: null,
    testStatus: "active",
    lastTestedAt: new Date().toISOString(),
    lastError: null,
  });
}

/**
 * Re-aktivasi awal bulan: pool yang di-disable otomatis (disabledReason="auto")
 * diaktifkan kembali sekali per bulan. Mengembalikan { monthKey, reset }.
 */
export async function monthlyResetProxyPools() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pools = await getProxyPools();
  let reset = 0;
  for (const pool of pools) {
    if (pool.disabledReason === "auto" && pool.lastMonthlyReset !== monthKey) {
      await updateProxyPool(pool.id, {
        isActive: true,
        consecutiveFailures: 0,
        disabledReason: null,
        disabledAt: null,
        lastMonthlyReset: monthKey,
        testStatus: "unknown",
      });
      reset += 1;
    }
  }
  return { monthKey, reset };
}
