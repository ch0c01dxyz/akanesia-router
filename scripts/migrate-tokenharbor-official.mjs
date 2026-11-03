// Run with Bun. Default is a read-only preview; --apply requires the server stopped.
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

const args = process.argv.slice(2);
const dbPath = args[args.indexOf("--db") + 1];
assert(args.includes("--db") && dbPath && !dbPath.startsWith("--"), "Provide --db <data.sqlite>");
const apply = args.includes("--apply");
const db = new Database(dbPath, apply ? { readwrite: true } : { readonly: true });
db.exec("PRAGMA busy_timeout = 5000");
const nodes = db.query("SELECT * FROM providerNodes").all().filter((row) => {
  const data = JSON.parse(row.data);
  return data.prefix === "tokenharbor" && data.baseUrl?.replace(/\/$/, "") === "https://tokenharbor.ai/v1";
});
assert(nodes.length <= 1, "Multiple Token Harbor custom nodes require review");
if (!nodes.length) {
  console.log(JSON.stringify({ migrated: 0, reason: "No unmigrated Token Harbor custom node" }));
  db.close();
  process.exit(0);
}
const node = nodes[0];
const source = db.query("SELECT * FROM providerConnections WHERE provider = ?").all(node.id);
assert(source.every((row) => row.authType === "apikey" && JSON.parse(row.data).apiKey), "Unexpected custom credentials");
const official = db.query("SELECT * FROM providerConnections WHERE provider = 'tokenharbor'").all();
const activeKeys = new Set(official.filter((row) => row.isActive).map((row) => JSON.parse(row.data).apiKey));
const models = db.query("SELECT * FROM kv WHERE scope = 'customModels'").all()
  .filter((row) => JSON.parse(row.value).providerAlias === node.id);
// The shared prefix already routes combos and aliases to the built-in provider.
const directRefs = db.query("SELECT models FROM combos").all().some((row) => row.models.includes(node.id)) ||
  db.query("SELECT * FROM kv WHERE scope != 'customModels'").all().some((row) => (row.key + row.value).includes(node.id));
assert(!directRefs, "Direct custom-node references require review before migration");
const duplicateCount = source.filter((row) => row.isActive && activeKeys.has(JSON.parse(row.data).apiKey)).length;
console.log(JSON.stringify({ mode: apply ? "apply" : "preview", connections: source.length, officialBefore: official.length, duplicateKeys: duplicateCount, modelDefinitions: models.length }));
if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(path.dirname(path.resolve(dbPath)), "backups", `before-tokenharbor-official-${stamp}.sqlite`);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  db.query("VACUUM INTO ?").run(backup);
  assert(fs.statSync(backup).size > 0, "Backup failed");
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const row of source) {
      const data = JSON.parse(row.data);
      const duplicate = row.isActive && activeKeys.has(data.apiKey);
      // Connection IDs and credentials stay intact; only custom transport metadata is retired.
      const specific = { ...(data.providerSpecificData || {}) };
      for (const field of ["prefix", "apiType", "baseUrl", "nodeName"]) delete specific[field];
      data.providerSpecificData = specific;
      db.query("UPDATE providerConnections SET provider = 'tokenharbor', isActive = ?, data = ?, updatedAt = ? WHERE id = ?")
        .run(duplicate ? 0 : row.isActive, JSON.stringify(data), now, row.id);
      if (row.isActive && !duplicate) activeKeys.add(data.apiKey);
    }
    // Keep the migrated group's routing order ahead of pre-existing official accounts.
    let priority = 0;
    for (const group of [source, official]) {
      for (const row of [...group].sort((a, b) => (a.priority || 999) - (b.priority || 999))) {
        db.query("UPDATE providerConnections SET priority = ? WHERE id = ?").run(++priority, row.id);
      }
    }
    // The global sticky round-robin can otherwise keep selecting the old official group.
    const settingsRow = db.query("SELECT data FROM settings WHERE id = 1").get();
    const settings = JSON.parse(settingsRow.data);
    settings.providerStrategies = {
      ...(settings.providerStrategies || {}),
      tokenharbor: { ...(settings.providerStrategies?.tokenharbor || {}), fallbackStrategy: "fill-first" },
    };
    db.query("UPDATE settings SET data = ? WHERE id = 1").run(JSON.stringify(settings));
    for (const row of models) {
      const model = { ...JSON.parse(row.value), providerAlias: "tokenharbor" };
      const key = `tokenharbor|${model.id}|${model.type || "llm"}`;
      const existing = db.query("SELECT value FROM kv WHERE scope = 'customModels' AND key = ?").get(key);
      const merged = { ...model, ...(existing ? JSON.parse(existing.value) : {}) };
      db.query("INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value")
        .run(key, JSON.stringify(merged));
      db.query("DELETE FROM kv WHERE scope = 'customModels' AND key = ?").run(row.key);
    }
    // Keep the empty node for rollback, with a prefix that cannot shadow the official provider.
    const legacy = { ...JSON.parse(node.data), prefix: "tokenharbor-legacy" };
    assert(!db.query("SELECT data FROM providerNodes WHERE id != ?").all(node.id)
      .some((row) => JSON.parse(row.data).prefix === legacy.prefix), "Legacy prefix already exists");
    db.query("UPDATE providerNodes SET name = ?, data = ?, updatedAt = ? WHERE id = ?")
      .run("Token Harbor (migrated)", JSON.stringify(legacy), now, node.id);
    assert.equal(db.query("SELECT count(*) AS n FROM providerConnections WHERE provider = ?").get(node.id).n, 0);
    assert.equal(db.query("SELECT count(*) AS n FROM providerConnections WHERE provider = 'tokenharbor'").get().n, official.length + source.length);
    for (const old of source) {
      const current = db.query("SELECT * FROM providerConnections WHERE id = ?").get(old.id);
      const before = JSON.parse(old.data), after = JSON.parse(current.data);
      assert.equal(after.apiKey, before.apiKey);
      assert.equal(current.createdAt, old.createdAt);
      for (const field of Object.keys(before).filter((key) => key !== "providerSpecificData")) {
        assert.deepEqual(after[field], before[field], `Unexpected data change: ${field}`);
      }
    }
    assert.equal(db.query("PRAGMA integrity_check").get().integrity_check, "ok");
  })();
  console.log(JSON.stringify({ migrated: source.length, duplicatesDisabled: duplicateCount, backup, integrity: "ok" }));
}
db.close();
