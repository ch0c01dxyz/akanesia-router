import { createHash } from "node:crypto";
import { HORDE_JOB_SCOPE, HORDE_MAX_PROMPT_CHARS, HORDE_POLL_INTERVAL_MS } from "../../../open-sse/config/hordeImageJobs.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const error = (code, status) => json({ error: { code } }, status);
const view = (job) => ({ id: job.id, model: job.model, state: job.state, ...(job.progress ? { progress: job.progress } : {}), ...(job.error ? { error: job.error } : {}) });

/** Synchronous SQLite mutations never yield; the unique KV row is the submission fence. */
export function createHordeJobRepository(db) {
  if (!["node:sqlite", "bun:sqlite"].includes(db.driver)) throw new Error("DURABLE_SQLITE_REQUIRED");
  const durableWrite = (write) => {
    const prior = db.get("PRAGMA synchronous").synchronous;
    if (![0, 1, 2, 3].includes(prior)) throw new Error("INVALID_SQLITE_DURABILITY");
    db.run("PRAGMA synchronous = FULL");
    try { return write(); }
    finally { db.run(`PRAGMA synchronous = ${prior}`); }
  };
  const get = (id) => {
    const row = db.get("SELECT value FROM kv WHERE scope = ? AND key = ?", [HORDE_JOB_SCOPE, id]);
    return row ? JSON.parse(row.value) : null;
  };
  return {
    get,
    reserve(job) {
      return durableWrite(() => db.run("INSERT OR IGNORE INTO kv(scope, key, value) VALUES(?, ?, ?)", [HORDE_JOB_SCOPE, job.id, JSON.stringify(job)]).changes === 1);
    },
    update(id, change) {
      let result;
      durableWrite(() => db.transaction(() => {
        const job = get(id);
        if (!job) throw new Error("JOB_NOT_FOUND");
        result = change(job);
        db.run("UPDATE kv SET value = ? WHERE scope = ? AND key = ?", [JSON.stringify(result), HORDE_JOB_SCOPE, id]);
      }));
      return result;
    },
  };
}

/** Ports keep authentication, the live credential store, and provider I/O outside the durable receipt. */
export function createHordeImageJobHandler({ repository, authenticate, authorize, selectConnection, getConnection, provider, now = Date.now }) {
  async function identity(request) {
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer ") || !await authenticate(bearer.slice(7))) return null;
    return hash(bearer.slice(7));
  }
  const requestJobId = (owner, requestId) => hash(`${owner}:${requestId.toLowerCase()}`);

  return async function handle(request, { id, requestId, result = false } = {}) {
    try {
      const owner = await identity(request);
      if (!owner) return error("UNAUTHORIZED", 401);
      if (request.signal.aborted) return error("REQUEST_ABORTED", 408);
      if (request.method === "POST") {
        const requestKey = request.headers.get("idempotency-key");
        if (!uuid(requestKey)) return error("INVALID_IDEMPOTENCY_KEY", 400);
        let bodyBytes;
        try { bodyBytes = await readRequest(request, HORDE_MAX_PROMPT_CHARS * 4 + 2048); }
        catch { return error("INVALID_IMAGE_JOB", 400); }
        let body;
        try { body = JSON.parse(bodyBytes); } catch { return error("INVALID_JSON", 400); }
        if (!body || Array.isArray(body) || typeof body.model !== "string" || !body.model.startsWith("aihorde/") || body.model.length > 512 || !body.model.slice(8).trim() ||
            typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > HORDE_MAX_PROMPT_CHARS || body.n !== 1 ||
            Object.keys(body).some((key) => !["model", "prompt", "n"].includes(key))) return error("INVALID_IMAGE_JOB", 400);
        const denied = await authorize(request, body.model);
        if (denied) return denied;
        const jobId = requestJobId(owner, requestKey);
        const inputHash = hash(JSON.stringify({ model: body.model, prompt: body.prompt, n: 1 }));
        const old = repository.get(jobId);
        if (old) return old.inputHash === inputHash ? json(view(old), 202) : error("IDEMPOTENCY_CONFLICT", 409);
        const connection = await selectConnection(body.model.slice(8));
        if (!connection?.connectionId || connection.allRateLimited) return error("PROVIDER_UNAVAILABLE", 503);
        if (request.signal.aborted) return error("REQUEST_ABORTED", 408);
        const job = { id: jobId, owner, model: body.model, inputHash, connectionId: connection.connectionId, state: "SUBMITTING", createdAt: now() };
        if (!repository.reserve(job)) {
          const existing = repository.get(jobId);
          return existing.inputHash === inputHash ? json(view(existing), 202) : error("IDEMPOTENCY_CONFLICT", 409);
        }
        // A caller disconnect after this fence must not cancel and re-submit upstream.
        let submitted;
        try { submitted = await provider.submit(body.model.slice(8), body.prompt, connection); }
        catch { submitted = { state: "UNKNOWN", error: "SUBMISSION_UNCONFIRMED" }; }
        const saved = repository.update(jobId, (current) => ({ ...current, ...submitted }));
        return json(view(saved), 202);
      }
      if (request.method !== "GET") return error("METHOD_NOT_ALLOWED", 405);
      if (requestId !== undefined) {
        if (!uuid(requestId)) return error("INVALID_REQUEST_ID", 400);
        id = requestJobId(owner, requestId);
      }
      if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) return error("JOB_NOT_FOUND", 404);
      let job = repository.get(id);
      if (!job || job.owner !== owner) return error("JOB_NOT_FOUND", 404);
      const denied = await authorize(request, job.model);
      if (denied) return denied;
      if (!job.upstreamId) return result ? error("RESULT_NOT_READY", 409) : json(view(job));
      const connection = await getConnection(job.connectionId, job.model.slice(8));
      if (!connection) return error("PROVIDER_UNAVAILABLE", 503);
      if (result) {
        if (job.state !== "SUCCEEDED") return error("RESULT_NOT_READY", 409);
        const image = await provider.result(job.upstreamId, connection);
        return new Response(image.bytes, { headers: { "Content-Type": image.contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (["QUEUED", "RUNNING"].includes(job.state) && (!job.lastCheckAt || now() - job.lastCheckAt >= HORDE_POLL_INTERVAL_MS)) {
        // Reserve a poll window atomically so concurrent clients don't hammer the public queue.
        let poll = false;
        repository.update(id, (current) => {
          if (["QUEUED", "RUNNING"].includes(current.state) && (!current.lastCheckAt || now() - current.lastCheckAt >= HORDE_POLL_INTERVAL_MS)) {
            poll = true;
            return { ...current, lastCheckAt: now() };
          }
          return current;
        });
        if (poll) {
          let status;
          try { status = await provider.check(job.upstreamId, connection); }
          catch { status = { error: "STATUS_UNAVAILABLE" }; }
          job = repository.update(id, (current) => ["QUEUED", "RUNNING"].includes(current.state) ? { ...current, error: undefined, ...status } : current);
        } else job = repository.get(id);
      }
      return json(view(job));
    } catch {
      return error("IMAGE_JOB_UNAVAILABLE", 503);
    }
  };
}

async function readRequest(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size).toString("utf8");
      size += value.byteLength;
      if (size > limit) throw new Error("REQUEST_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
