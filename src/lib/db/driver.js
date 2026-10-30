import { ensureDirs, DATA_FILE } from "./paths.js";
import { stripNullBytes } from "./helpers/nullBytes.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

/**
 * Make every bound string NUL-safe, once, for all drivers.
 *
 * SQLite stores TEXT as a NUL-terminated C string, so a bound string with an
 * embedded NUL is silently truncated by node:sqlite. Values that carry raw
 * bytes — a model id or endpoint from the request, tool output, a diff — can
 * contain one, and the write then loses the tail without a trace.
 * Sanitising at the binding boundary covers every driver and every column
 * type with a single rule, instead of one call site at a time.
 *
 * @param {object} adapter
 * @returns {object} adapter with NUL-safe run/get/all
 */
function withNullByteSafeParams(adapter) {
  const clean = (params) => (Array.isArray(params) ? params.map(stripNullBytes) : params);
  return {
    ...adapter,
    run: (sql, params = []) => adapter.run(sql, clean(params)),
    get: (sql, params = []) => adapter.get(sql, clean(params)),
    all: (sql, params = []) => adapter.all(sql, clean(params)),
  };
}

async function initAdapter() {
  ensureDirs();
  // Order per runtime (Node >= 24 required — see package.json engines):
  //   Bun:  bun:sqlite → sql.js
  //   Node: node:sqlite → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/node/sql.js all failed)");

  adapter = withNullByteSafeParams(adapter);

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
