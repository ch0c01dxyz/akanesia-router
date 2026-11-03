import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("./migrate-tokenharbor-official.mjs", import.meta.url));

function fixture(check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenharbor-migration-test-"));
  const file = path.join(dir, "data.sqlite");
  const db = new Database(file);
  db.exec(`
    CREATE TABLE providerNodes(id TEXT PRIMARY KEY, name TEXT, data TEXT, updatedAt TEXT);
    CREATE TABLE providerConnections(id TEXT PRIMARY KEY, provider TEXT, authType TEXT, isActive INTEGER, data TEXT, createdAt TEXT, updatedAt TEXT, priority INTEGER DEFAULT 1);
    CREATE TABLE combos(models TEXT);
    CREATE TABLE settings(id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE kv(scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope,key));
  `);
  db.query("INSERT INTO settings VALUES(1,?)").run(JSON.stringify({ fallbackStrategy: "round-robin" }));
  db.query("INSERT INTO providerNodes VALUES(?,?,?,?)").run("custom-node", "Token Harbor", JSON.stringify({ prefix: "tokenharbor", baseUrl: "https://tokenharbor.ai/v1" }), "before");
  const data = (apiKey) => JSON.stringify({ apiKey, modelLock_example: "2030-01-01", providerSpecificData: { baseUrl: "https://tokenharbor.ai/v1", prefix: "tokenharbor", proxyPoolId: "keep-proxy" } });
  for (const [id, provider, key] of [["existing", "tokenharbor", "duplicate-fixture"], ["duplicate", "custom-node", "duplicate-fixture"], ["unique", "custom-node", "unique-fixture"]]) {
    db.query("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES(?,?,?,1,?,?,?)").run(id, provider, "apikey", data(key), "created", "before");
  }
  db.query("INSERT INTO kv VALUES('customModels',?,?)").run("custom-node|example|llm", JSON.stringify({ providerAlias: "custom-node", id: "example", type: "llm", name: "Custom", caps: { vision: true } }));
  db.query("INSERT INTO kv VALUES('customModels',?,?)").run("tokenharbor|example|llm", JSON.stringify({ providerAlias: "tokenharbor", id: "example", type: "llm", name: "Existing" }));
  const run = (...args) => spawnSync(process.execPath, [script, "--db", file, ...args], { encoding: "utf8" });
  try { check(db, run, dir); } finally {
    db.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("tokenharbor-migration-test-")) throw Error("Invalid cleanup path");
    fs.rmSync(resolved, { recursive: true });
  }
}

test("preview does not change data or create backups", () => fixture((db, run, dir) => {
  expect(run().status).toBe(0);
  expect(db.query("SELECT count(*) AS n FROM providerConnections WHERE provider='custom-node'").get().n).toBe(2);
  expect(fs.existsSync(path.join(dir, "backups"))).toBe(false);
}));

test("migration preserves credentials and IDs, avoids duplicate active keys, merges model metadata and is idempotent", () => fixture((db, run, dir) => {
  const applied = run("--apply");
  if (applied.status !== 0) throw Error(applied.stderr);
  expect(db.query("SELECT count(*) AS n FROM providerConnections WHERE provider='tokenharbor'").get().n).toBe(3);
  expect(db.query("SELECT isActive FROM providerConnections WHERE id='duplicate'").get().isActive).toBe(0);
  const row = db.query("SELECT * FROM providerConnections WHERE id='unique'").get();
  expect(row.isActive).toBe(1);
  expect(row.createdAt).toBe("created");
  expect(row.priority).toBeLessThan(db.query("SELECT priority FROM providerConnections WHERE id='existing'").get().priority);
  const settings = JSON.parse(db.query("SELECT data FROM settings WHERE id=1").get().data);
  expect(settings.fallbackStrategy).toBe("round-robin");
  expect(settings.providerStrategies.tokenharbor.fallbackStrategy).toBe("fill-first");
  expect(JSON.parse(row.data)).toEqual({ apiKey: "unique-fixture", modelLock_example: "2030-01-01", providerSpecificData: { proxyPoolId: "keep-proxy" } });
  const model = JSON.parse(db.query("SELECT value FROM kv WHERE key='tokenharbor|example|llm'").get().value);
  expect(model.name).toBe("Existing");
  expect(model.caps.vision).toBe(true);
  expect(db.query("SELECT count(*) AS n FROM kv WHERE key LIKE 'custom-node|%'").get().n).toBe(0);
  const backup = new Database(path.join(dir, "backups", fs.readdirSync(path.join(dir, "backups"))[0]), { readonly: true });
  expect(backup.query("SELECT provider FROM providerConnections WHERE id='unique'").get().provider).toBe("custom-node");
  backup.close();
  expect(run("--apply").status).toBe(0);
  expect(fs.readdirSync(path.join(dir, "backups")).length).toBe(1);
}));

test("a conflicting legacy prefix rolls back all connection and model changes", () => fixture((db, run) => {
  db.query("INSERT INTO providerNodes VALUES('conflict','Conflict',?,'before')").run(JSON.stringify({ prefix: "tokenharbor-legacy" }));
  expect(run("--apply").status).not.toBe(0);
  expect(db.query("SELECT provider FROM providerConnections WHERE id='unique'").get().provider).toBe("custom-node");
  expect(db.query("SELECT count(*) AS n FROM kv WHERE key='custom-node|example|llm'").get().n).toBe(1);
}));
