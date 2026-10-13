import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

// getComboByName harus case-insensitive agar selaras dengan access gate
// (keyAccess.js) yang membandingkan nama combo tanpa kapitalisasi.
const memDb = new DatabaseSync(":memory:");
memDb.exec(buildCreateTableSql("combos", TABLES.combos));

const fakeAdapter = {
  get: (sql, params = []) => memDb.prepare(sql).get(...params),
  all: (sql, params = []) => memDb.prepare(sql).all(...params),
  run: (sql, params = []) => memDb.prepare(sql).run(...params),
  transaction: (fn) => fn(),
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => fakeAdapter,
}));

const { createCombo, getComboByName } = await import("@/lib/db/repos/combosRepo.js");

beforeEach(async () => {
  memDb.exec("DELETE FROM combos");
  await createCombo({ name: "Main", models: ["openai/gpt-5"] });
});

describe("getComboByName case-insensitive", () => {
  it("menemukan 'Main' saat dicari 'main' / 'MAIN'", async () => {
    expect((await getComboByName("main"))?.name).toBe("Main");
    expect((await getComboByName("MAIN"))?.name).toBe("Main");
    expect((await getComboByName("Main"))?.name).toBe("Main");
  });

  it("tetap null untuk nama yang tidak ada", async () => {
    expect(await getComboByName("tidak-ada")).toBeNull();
  });
});
