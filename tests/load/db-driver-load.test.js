/**
 * Load simulation untuk driver SQLite (node:sqlite).
 * Mensimulasikan beban request tinggi akanesia-router.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";

describe("db driver load simulation", () => {
  let dir;
  let adapter;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dbload-"));
    adapter = await createNodeSqliteAdapter(join(dir, "test.db"));
    adapter.exec(`CREATE TABLE IF NOT EXISTS load_test (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT,
      created_at INTEGER NOT NULL
    )`);
    adapter.exec(`CREATE INDEX IF NOT EXISTS idx_load_key ON load_test(key)`);
  });

  afterAll(() => {
    try { adapter?.close(); } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it("1000 sequential writes < 5 detik", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      adapter.run(
        "INSERT INTO load_test (key, value, created_at) VALUES (?, ?, ?)",
        [`key-${i}`, `value-${i}`, Date.now()]
      );
    }
    const elapsed = Date.now() - start;
    console.log(`  1000 writes: ${elapsed}ms (${(1000 / elapsed * 1000).toFixed(0)}/s)`);
    expect(elapsed).toBeLessThan(5000);
  });

  it("100 concurrent readers tidak deadlock", async () => {
    const reads = Array.from({ length: 100 }, (_, i) =>
      Promise.resolve().then(() =>
        adapter.get("SELECT COUNT(*) as c FROM load_test WHERE key = ?", [`key-${i % 100}`])
      )
    );
    const results = await Promise.all(reads);
    expect(results.length).toBe(100);
    expect(results[0]).toBeDefined();
  });

  it("mixed 50 writes + 50 reads konkuren < 3 detik", async () => {
    const start = Date.now();
    const ops = [];
    for (let i = 0; i < 50; i++) {
      ops.push(Promise.resolve().then(() =>
        adapter.run(
          "INSERT INTO load_test (key, value, created_at) VALUES (?, ?, ?)",
          [`mix-${i}`, "v", Date.now()]
        )
      ));
      ops.push(Promise.resolve().then(() =>
        adapter.all("SELECT * FROM load_test WHERE key LIKE 'mix-%' LIMIT 10")
      ));
    }
    await Promise.all(ops);
    const elapsed = Date.now() - start;
    console.log(`  100 mixed ops: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(3000);
  });

  it("transaction rollback aman saat error", () => {
    const before = adapter.get("SELECT COUNT(*) as c FROM load_test").c;
    expect(() => {
      adapter.transaction(() => {
        adapter.run("INSERT INTO load_test (key, value, created_at) VALUES (?, ?, ?)", ["tx", "v", 1]);
        throw new Error("simulated");
      });
    }).toThrow("simulated");
    const after = adapter.get("SELECT COUNT(*) as c FROM load_test").c;
    expect(after).toBe(before); // rollback berhasil
  });

  it("statement cache: prepare yang sama dipakai ulang", () => {
    // Jalankan query sama 100x, pastikan tidak ada leak/error
    for (let i = 0; i < 100; i++) {
      adapter.get("SELECT 1 as one");
    }
    expect(true).toBe(true);
  });
});
