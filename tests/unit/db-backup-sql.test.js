import { describe, it, expect } from "vitest";
import { toBackupTableSql } from "../../src/lib/db/backup.js";

describe("toBackupTableSql", () => {
  it("menangani CREATE TABLE IF NOT EXISTS (dipakai semua tabel schema.js)", () => {
    const out = toBackupTableSql(
      "CREATE TABLE IF NOT EXISTS providerConnections(id TEXT PRIMARY KEY)"
    );
    expect(out).toBe(
      "CREATE TABLE bak.providerConnections(id TEXT PRIMARY KEY)"
    );
  });

  it("menangani CREATE TABLE tanpa IF NOT EXISTS", () => {
    const out = toBackupTableSql("CREATE TABLE kv(k TEXT, v TEXT)");
    expect(out).toBe("CREATE TABLE bak.kv(k TEXT, v TEXT)");
  });

  it("tidak merusak sisa statement (kolom, constraint)", () => {
    const out = toBackupTableSql(
      "create table if not exists quota_incidents(id TEXT, data TEXT NOT NULL)"
    );
    expect(out).toBe(
      "CREATE TABLE bak.quota_incidents(id TEXT, data TEXT NOT NULL)"
    );
  });
});
