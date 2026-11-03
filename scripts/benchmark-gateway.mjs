// Bun-only bounded streaming benchmark; reads a local gateway key without printing it.
import { Database } from "bun:sqlite";
import fs from "node:fs";
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
for (const flag of ["--db", "--models", "--out"]) assert(args.includes(flag), `Provide ${flag}`);
const db = new Database(option("--db"), { readonly: true });
const key = db.query("SELECT key FROM apiKeys WHERE isActive=1 AND accessRestricted=0 LIMIT 1").get()?.key;
db.close();
assert(key, "No unrestricted gateway key available");
const baseUrl = args.includes("--base-url") ? option("--base-url") : "http://localhost:20127";
const models = option("--models").split(",");
assert(models.length > 0 && models.every((model) => model.includes("/")), "Provide provider/model IDs");
const jobs = models.flatMap((model) => Array.from({ length: 8 }, () => model));
const results = [];
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < jobs.length) {
    const model = jobs[cursor++], start = performance.now();
    const item = { model, status: null, firstTokenMs: null, completed: false };
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply OK only." }], max_tokens: 16, reasoning_effort: "low", stream: true }),
        signal: AbortSignal.timeout(30000),
      });
      item.status = response.status;
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "", bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          assert(bytes <= 1024 * 1024, "Benchmark response too large");
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") { item.completed = true; continue; }
            try {
              const event = JSON.parse(data);
              const delta = event.choices?.[0]?.delta;
              if (item.firstTokenMs === null && (delta?.content || delta?.reasoning_content)) item.firstTokenMs = Math.round(performance.now() - start);
              if (event.error) item.streamError = true;
            } catch { /* Ignore non-JSON provider event lines. */ }
          }
        }
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) { item.error = error.name; }
    item.totalMs = Math.round(performance.now() - start);
    results.push(item);
  }
}));
assert.equal(results.length, jobs.length);
const percentile = (values, fraction) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] : null;
const summary = models.map((model) => {
  const rows = results.filter((item) => item.model === model);
  const successful = rows.filter((item) => item.status === 200 && item.completed && !item.error && !item.streamError);
  return { model, requests: rows.length, successful: successful.length,
    p50Ms: percentile(successful.map((item) => item.totalMs), 0.5), p95Ms: percentile(successful.map((item) => item.totalMs), 0.95),
    firstTokenP95Ms: percentile(successful.map((item) => item.firstTokenMs).filter((ms) => ms !== null), 0.95) };
});
fs.writeFileSync(option("--out"), JSON.stringify({ concurrency: 3, maxTokens: 16, summary, results }, null, 2));
console.log(JSON.stringify(summary));
