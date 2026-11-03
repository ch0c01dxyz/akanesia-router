// Bun-only, bounded live credential check. Report contains IDs and status, never keys.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
assert(args.includes("--db") && args.includes("--out"), "Provide --db and --out");
const db = new Database(option("--db"), { readonly: true });
const rows = db.query("SELECT id,data FROM providerConnections WHERE provider='tokenharbor' AND isActive=1").all();
db.close();
const seen = new Set();
const accounts = rows.filter((row) => {
  const key = JSON.parse(row.data).apiKey;
  assert(typeof key === "string" && key.length > 0, "Missing credential");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const results = [];
let cursor = 0;
const startedAt = new Date().toISOString();
const checkpoint = () => {
  const counts = results.reduce((all, item) => ({ ...all, [item.result]: (all[item.result] || 0) + 1 }), {});
  fs.writeFileSync(option("--out"), JSON.stringify({ startedAt, updatedAt: new Date().toISOString(), total: accounts.length, completed: results.length, counts, results }, null, 2));
  console.log(JSON.stringify({ completed: results.length, total: accounts.length, counts }));
};
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < accounts.length) {
    const row = accounts[cursor++];
    const start = Date.now();
    let status = null, result;
    try {
      const response = await fetch("https://tokenharbor.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${JSON.parse(row.data).apiKey}` },
        body: JSON.stringify({ model: "deepseek-v4.1-flash:free", messages: [{ role: "user", content: "Reply OK." }], max_tokens: 8, stream: false }),
        signal: AbortSignal.timeout(15000),
      });
      status = response.status;
      const body = await response.json();
      result = response.ok && Array.isArray(body.choices) && body.choices.length ? "valid"
        : status === 403 && /email_verification/i.test(body.error?.type || "") ? "email_verification_required"
        : status === 401 ? "invalid_auth"
        : status === 402 ? "quota_or_balance"
        : status === 429 ? "rate_or_quota_limited"
        : status === 403 ? "access_denied" : "upstream_error";
    } catch (error) {
      result = error.name === "TimeoutError" ? "timeout" : "network_or_response_error";
    }
    results.push({ connectionId: row.id, status, result, latencyMs: Date.now() - start });
    if (results.length % 20 === 0) checkpoint();
  }
}));
assert.equal(results.length, accounts.length);
assert.equal(new Set(results.map((item) => item.connectionId)).size, accounts.length);
checkpoint();
