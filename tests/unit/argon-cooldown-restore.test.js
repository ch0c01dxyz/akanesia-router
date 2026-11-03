import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

// Cooldown Antigravity harus selamat dari restart: disimpan di kv, lalu
// dikembalikan ke cache in-memory saat pertama kali dibutuhkan lagi.
const memDb = new DatabaseSync(":memory:");
memDb.exec(buildCreateTableSql("kv", TABLES.kv));

const fakeAdapter = {
  get: (sql, params = []) => memDb.prepare(sql).get(...params),
  all: (sql, params = []) => memDb.prepare(sql).all(...params),
  run: (sql, params = []) => memDb.prepare(sql).run(...params),
  transaction: (fn) => fn(),
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => fakeAdapter,
}));

const {
  saveAntigravityCooldown,
  ensureAntigravityCooldownsRestored,
  __resetArgonCooldownRestoreForTests,
} = await import("@/sse/services/argonCooldownStore.js");

beforeEach(async () => {
  memDb.exec("DELETE FROM kv");
  __resetArgonCooldownRestoreForTests();
});

describe("argon cooldown restore after restart", () => {
  it("cooldown masa depan kembali ke cache kosong (simulasi restart)", async () => {
    const future = Date.now() + 600_000;
    await saveAntigravityCooldown("conn-1", "model-a", future);
    // Cache in-memory kosong = kondisi setelah restart.
    const freshCache = new Map();
    await ensureAntigravityCooldownsRestored(freshCache);
    const entry = freshCache.get("conn-1")?.["model-a"];
    expect(entry?.remainingPercentage).toBe(0);
    expect(new Date(entry.resetAt).getTime()).toBe(future);
  });

  it("cooldown kedaluwarsa tidak dikembalikan", async () => {
    await saveAntigravityCooldown("conn-1", "model-a", Date.now() + 600_000);
    // Tulis langsung entri kedaluwarsa (save menolak nilai lewat waktu).
    memDb.prepare(
      "INSERT INTO kv(scope, key, value) VALUES('argonCooldowns', 'conn-1|model-b', ?)"
    ).run(JSON.stringify({ resetAt: new Date(Date.now() - 1000).toISOString() }));
    const freshCache = new Map();
    await ensureAntigravityCooldownsRestored(freshCache);
    expect(freshCache.get("conn-1")?.["model-a"]).toBeDefined();
    expect(freshCache.get("conn-1")?.["model-b"]).toBeUndefined();
  });

  it("data segar di memori menang atas data tersimpan", async () => {
    const future = Date.now() + 600_000;
    await saveAntigravityCooldown("conn-1", "model-a", future);
    const freshCache = new Map([
      ["conn-1", { "model-a": { remainingPercentage: 0, resetAt: new Date(future + 600_000).toISOString() } }],
    ]);
    await ensureAntigravityCooldownsRestored(freshCache);
    expect(new Date(freshCache.get("conn-1")["model-a"].resetAt).getTime()).toBe(future + 600_000);
  });

  it("restore hanya berjalan sekali per proses sampai di-reset", async () => {
    const future = Date.now() + 600_000;
    await saveAntigravityCooldown("conn-1", "model-a", future);
    const cache = new Map();
    await ensureAntigravityCooldownsRestored(cache);
    expect(cache.get("conn-1")).toBeDefined();
    // Panggilan kedua tanpa reset tidak menyentuh cache baru.
    const secondCache = new Map();
    await ensureAntigravityCooldownsRestored(secondCache);
    expect(secondCache.size).toBe(0);
  });
});
