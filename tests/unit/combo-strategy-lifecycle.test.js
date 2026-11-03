import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

// Strategi combo disimpan di settings.comboStrategies dengan kunci NAMA combo.
// Mengganti nama combo harus memindahkan strateginya, menghapus combo harus
// menghapus strateginya, dan models yang bukan array string harus ditolak
// (kalau lolos, combo rusak: downstream mengira models adalah array).
const memDb = new DatabaseSync(":memory:");
memDb.exec(buildCreateTableSql("combos", TABLES.combos));
memDb.exec(buildCreateTableSql("settings", TABLES.settings));

const fakeAdapter = {
  get: (sql, params = []) => memDb.prepare(sql).get(...params),
  all: (sql, params = []) => memDb.prepare(sql).all(...params),
  run: (sql, params = []) => memDb.prepare(sql).run(...params),
  transaction: (fn) => fn(),
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => fakeAdapter,
}));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: () => {},
}));

const { createCombo, getComboById } = await import("@/lib/db/repos/combosRepo.js");
const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
const { PUT, DELETE } = await import("@/app/api/combos/[id]/route.js");
const { POST } = await import("@/app/api/combos/route.js");

function req(method, body) {
  return new Request("http://localhost/api/combos/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedComboWithStrategy(name) {
  const combo = await createCombo({ name, models: ["openai/gpt-5"] });
  memDb
    .prepare("INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(JSON.stringify({ comboStrategies: { [name]: { fallbackStrategy: "smart", routerModel: "nace/drex-max" } } }));
  return combo;
}

beforeEach(() => {
  memDb.exec("DELETE FROM combos");
  memDb.exec("DELETE FROM settings");
});

describe("rename combo memindahkan strategi", () => {
  it("PUT ganti nama: strategi ikut pindah ke nama baru, kunci lama hilang", async () => {
    const combo = await seedComboWithStrategy("alpha");
    const res = await PUT(req("PUT", { name: "beta" }), { params: Promise.resolve({ id: combo.id }) });
    expect(res.status).toBe(200);
    const strategies = (await getSettings()).comboStrategies;
    expect(strategies.beta).toEqual({ fallbackStrategy: "smart", routerModel: "nace/drex-max" });
    expect(strategies.alpha).toBeUndefined();
  });
});

describe("hapus combo menghapus strategi", () => {
  it("DELETE: entri strategi nama combo ikut terhapus", async () => {
    const combo = await seedComboWithStrategy("alpha");
    const res = await DELETE(req("DELETE"), { params: Promise.resolve({ id: combo.id }) });
    expect(res.status).toBe(200);
    expect((await getSettings()).comboStrategies.alpha).toBeUndefined();
  });
});

describe("models harus array string", () => {
  it("PUT menolak models string dan combo tidak berubah", async () => {
    const combo = await seedComboWithStrategy("alpha");
    const res = await PUT(req("PUT", { models: "openai/gpt-5" }), { params: Promise.resolve({ id: combo.id }) });
    expect(res.status).toBe(400);
    expect((await getComboById(combo.id)).models).toEqual(["openai/gpt-5"]);
  });

  it("POST menolak models string dan tidak membuat combo", async () => {
    const res = await POST(req("POST", { name: "baru", models: "openai/gpt-5" }));
    expect(res.status).toBe(400);
  });

  it("POST menolak models berisi non-string", async () => {
    const res = await POST(req("POST", { name: "baru", models: ["openai/gpt-5", 42] }));
    expect(res.status).toBe(400);
  });
});
