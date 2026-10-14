import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

// Adapter palsu berbasis SQLite in-memory: menguji SQL repo yang sebenarnya
// (termasuk klausa upsert ON CONFLICT) tanpa menyentuh file DB.
const memDb = new DatabaseSync(":memory:");
memDb.exec(buildCreateTableSql("quota_incidents", TABLES.quota_incidents));

const fakeAdapter = {
  get: (sql, params = []) => memDb.prepare(sql).get(...params),
  all: (sql, params = []) => memDb.prepare(sql).all(...params),
  run: (sql, params = []) => memDb.prepare(sql).run(...params),
  transaction: (fn) => fn(),
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => fakeAdapter,
}));

const { upsertIncident, removeIncident, removeIncidentsByConnection, listIncidents } = await import(
  "@/lib/db/repos/quotaIncidentsRepo.js"
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  memDb.exec("DELETE FROM quota_incidents");
});

describe("quotaIncidentsRepo", () => {
  it("upsert lalu list: insert baru + mapping camelCase", async () => {
    await upsertIncident({
      connectionId: "conn-1",
      model: "gpt-5",
      provider: "openai",
      errorClass: "rate_limited",
      lastError: "429 Too Many Requests",
      lastStatus: 429,
      failureCount: 3,
    });
    const rows = await listIncidents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      connectionId: "conn-1",
      model: "gpt-5",
      provider: "openai",
      errorClass: "rate_limited",
      lastError: "429 Too Many Requests",
      lastStatus: 429,
      failureCount: 3,
    });
    expect(rows[0].firstSeen).toBeTruthy();
    expect(rows[0].updatedAt).toBeTruthy();
  });

  it("upsert kedua: update (first_seen tetap, updated_at refresh)", async () => {
    await upsertIncident({ connectionId: "c", model: "m", failureCount: 1, lastError: "429" });
    const first = (await listIncidents())[0];
    await sleep(5);
    await upsertIncident({
      connectionId: "c",
      model: "m",
      provider: "p",
      errorClass: "quota_exhausted",
      lastError: "quota habis",
      lastStatus: 429,
      failureCount: 2,
    });
    const rows = await listIncidents();
    expect(rows).toHaveLength(1);
    expect(rows[0].failureCount).toBe(2);
    expect(rows[0].errorClass).toBe("quota_exhausted");
    expect(rows[0].firstSeen).toBe(first.firstSeen);
    expect(new Date(rows[0].updatedAt) >= new Date(first.updatedAt)).toBe(true);
  });

  it("removeIncident menghapus; no-op bila tidak ada", async () => {
    await upsertIncident({ connectionId: "c", model: "m", failureCount: 1 });
    await removeIncident("tidak-ada", "m");
    expect(await listIncidents()).toHaveLength(1);
    await removeIncident("c", "m");
    expect(await listIncidents()).toHaveLength(0);
    await removeIncident("c", "m"); // no-op, tidak throw
  });

  it("listIncidents urut updatedAt desc", async () => {
    await upsertIncident({ connectionId: "lama", model: "m1", failureCount: 1 });
    await sleep(5);
    await upsertIncident({ connectionId: "baru", model: "m2", failureCount: 1 });
    const rows = await listIncidents();
    expect(rows.map((r) => r.connectionId)).toEqual(["baru", "lama"]);
  });

  it("upsert tanpa connectionId adalah no-op; model kosong dinormalisasi", async () => {
    await upsertIncident({ model: "m", failureCount: 1 });
    expect(await listIncidents()).toHaveLength(0);
    // Tanpa model: tetap dicatat dengan model "" (tidak terikat satu model).
    await upsertIncident({ connectionId: "c", failureCount: 1 });
    const rows = await listIncidents();
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe("");
    await removeIncident("c", "");
    expect(await listIncidents()).toHaveLength(0);
  });

  it("removeIncidentsByConnection: hapus semua insiden satu koneksi", async () => {
    await upsertIncident({ connectionId: "c1", model: "m1", failureCount: 1 });
    await upsertIncident({ connectionId: "c1", model: "m2", failureCount: 2 });
    await upsertIncident({ connectionId: "c2", model: "m1", failureCount: 1 });
    const n = await removeIncidentsByConnection("c1");
    expect(n).toBe(2);
    const rows = await listIncidents();
    expect(rows).toHaveLength(1);
    expect(rows[0].connectionId).toBe("c2");
  });

  it("removeIncidentsByConnection tanpa connectionId adalah no-op", async () => {
    await upsertIncident({ connectionId: "c1", model: "m1", failureCount: 1 });
    expect(await removeIncidentsByConnection()).toBe(0);
    expect(await listIncidents()).toHaveLength(1);
  });
});
