import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { createHordeImageJobHandler, createHordeJobRepository } from "../../src/sse/services/hordeImageJobs.js";
import { createHordeJobProvider } from "../../open-sse/handlers/imageProviders/hordeJobs.js";
import { HORDE_MAX_IMAGE_BYTES, HORDE_POLL_TIMEOUT_MS } from "../../open-sse/config/hordeImageJobs.js";
import hordeAdapter from "../../open-sse/handlers/imageProviders/aihorde.js";

const requestId = "aa81bfd1-8ceb-4176-9ddb-ed5d1204ec47";
const upstreamId = "87550ea8-ad1a-4714-bef8-f5c106f9a567";
const body = { model: "aihorde/stable_diffusion", prompt: "A quiet mountain", n: 1 };
const request = (method = "POST", data = body, key = "fixture-key", signal) => new Request("http://gateway.test/v1/images/jobs", {
  method, headers: { Authorization: `Bearer ${key}`, "Idempotency-Key": requestId }, ...(method === "POST" ? { body: JSON.stringify(data) } : {}), signal,
});

function sqlite(file = ":memory:") {
  const raw = new DatabaseSync(file);
  raw.exec("CREATE TABLE IF NOT EXISTS kv(scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope,key))");
  return {
    driver: "node:sqlite", raw,
    run: (sql, params = []) => raw.prepare(sql).run(...params),
    get: (sql, params = []) => raw.prepare(sql).get(...params),
    transaction(fn) { raw.exec("BEGIN IMMEDIATE"); try { const result = fn(); raw.exec("COMMIT"); return result; } catch (e) { raw.exec("ROLLBACK"); throw e; } },
  };
}
function fixture(options = {}) {
  const db = options.db || sqlite();
  const calls = { submit: 0, check: 0, result: 0, select: 0, connection: 0 };
  let time = 100000;
  let denied = false;
  let revoked = false;
  const repository = createHordeJobRepository(db);
  const provider = {
    async submit(...args) { calls.submit++; return options.submit ? options.submit(...args) : { state: "QUEUED", upstreamId }; },
    async check(...args) { calls.check++; return options.check ? options.check(...args) : { state: "SUCCEEDED" }; },
    async result(...args) { calls.result++; return options.result ? options.result(...args) : { bytes: Buffer.from([255, 216, 255, 0]), contentType: "image/jpeg" }; },
  };
  const handler = createHordeImageJobHandler({
    repository, provider, now: () => time,
    authenticate: async (key) => key === "fixture-key" || key === "another-owner",
    authorize: async () => denied ? new Response(null, { status: 403 }) : null,
    selectConnection: async () => { calls.select++; return { connectionId: "fixture-connection" }; },
    getConnection: async () => { calls.connection++; return revoked ? null : { apiKey: "current-fixture-credential" }; },
  });
  return { handler, calls, repository, db, advance: () => { time += 6000; }, deny: () => { denied = true; }, revoke: () => { revoked = true; } };
}

test("requires valid Bearer even when local gateway authentication could otherwise be optional", async () => {
  const f = fixture();
  assert.equal((await f.handler(request("POST", body, "invalid"))).status, 401);
  assert.equal((await f.handler(new Request("http://gateway.test", { method: "POST" }))).status, 401);
  assert.equal(f.calls.submit, 0);
});
test("rejects invalid count, prompt, provider and request identity before submission", async () => {
  const f = fixture();
  for (const invalid of [{ ...body, n: 2 }, { ...body, prompt: "" }, { ...body, prompt: "a".repeat(16001) }, { ...body, model: "nb/model" }, { ...body, size: "1024x1024" }]) {
    assert.equal((await f.handler(request("POST", invalid))).status, 400);
  }
  const invalidId = request(); invalidId.headers.set("Idempotency-Key", "guess");
  assert.equal((await f.handler(invalidId)).status, 400);
  assert.equal(f.calls.submit, 0);
});
test("identical replays and concurrent clients perform exactly one upstream POST; changed input conflicts", async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({ length: 12 }, () => f.handler(request())));
  const jobs = await Promise.all(responses.map((response) => response.json()));
  assert.equal(f.calls.submit, 1);
  assert.equal(new Set(jobs.map((job) => job.id)).size, 1);
  assert.match(jobs[0].id, /^[0-9a-f]{64}$/);
  assert.equal((await f.handler(request("POST", { ...body, prompt: "changed" }))).status, 409);
});
test("persists receipt before dispatch, does not persist credentials or prompt, and recovers after SQLite reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "horde-jobs-"));
  const path = join(dir, "jobs.sqlite");
  let db = sqlite(path);
  try {
    let observed;
    const f = fixture({ db, submit: async () => {
      observed = db.raw.prepare("SELECT value FROM kv").get().value;
      return { state: "QUEUED", upstreamId };
    } });
    const original = await (await f.handler(request())).json();
    assert.equal(JSON.parse(observed).state, "SUBMITTING");
    assert.equal(observed.includes(body.prompt), false);
    assert.equal(observed.includes("fixture-key"), false);
    db.raw.close(); db = sqlite(path);
    const restarted = fixture({ db });
    const resumed = await (await restarted.handler(request("GET"), { requestId })).json();
    assert.equal(resumed.id, original.id);
    assert.equal(resumed.state, "SUCCEEDED");
    assert.equal(restarted.calls.submit, 0);
    assert.equal(restarted.calls.check, 1);
  } finally { db.raw.close(); rmSync(dir, { recursive: true }); }
});
test("lost submit response and malformed acceptance remain UNKNOWN; GET/replay never resubmit", async () => {
  const f = fixture({ submit: async () => { throw new Error("lost response containing secret"); } });
  const job = await (await f.handler(request())).json();
  assert.equal(job.state, "UNKNOWN");
  assert.equal((await (await f.handler(request("GET"), { requestId })).json()).id, job.id);
  assert.equal((await (await f.handler(request())).json()).state, "UNKNOWN");
  assert.equal(f.calls.submit, 1);
  assert.equal(f.calls.check, 0);
  assert.equal(JSON.stringify(job).includes("secret"), false);
});
test("crashed SUBMITTING receipt and lookup404 cannot cause a new provider job", async () => {
  const f = fixture();
  const job = await (await f.handler(request())).json();
  f.repository.update(job.id, (old) => ({ ...old, state: "SUBMITTING", upstreamId: undefined }));
  assert.equal((await (await f.handler(request("GET"), { requestId })).json()).state, "SUBMITTING");
  assert.equal((await (await f.handler(request())).json()).state, "SUBMITTING");
  assert.equal((await f.handler(request("GET"), { requestId: "8ade835b-0302-4c6b-8618-2a1d62835baa" })).status, 404);
  assert.equal(f.calls.submit, 1);
});
test("other key cannot see receipt or result; current model access and pinned connection disable are enforced", async () => {
  const f = fixture(); const job = await (await f.handler(request())).json();
  assert.equal((await f.handler(request("GET", body, "another-owner"), { id: job.id })).status, 404);
  assert.equal((await f.handler(request("GET", body, "another-owner"), { id: job.id, result: true })).status, 404);
  f.revoke();
  assert.equal((await f.handler(request("GET"), { id: job.id })).status, 503);
  assert.equal(f.calls.check, 0);
  f.deny();
  assert.equal((await f.handler(request("GET"), { requestId })).status, 403);
  assert.equal((await f.handler(request())).status, 403);
  assert.equal(f.calls.submit, 1);
});
test("more than six temporary poll failures retain same job and later recover; poll windows suppress concurrent checks", async () => {
  let polls = 0;
  const f = fixture({ check: async () => { if (++polls <= 8) throw new Error("429 temporary secret"); return { state: "SUCCEEDED", progress: { queuePosition: 0 } }; } });
  const job = await (await f.handler(request())).json();
  for (let i = 0; i < 8; i++) {
    const receipt = await (await f.handler(request("GET"), { id: job.id })).json();
    assert.equal(receipt.state, "QUEUED"); assert.equal(receipt.error, "STATUS_UNAVAILABLE"); f.advance();
  }
  const receipts = await Promise.all(Array.from({ length: 8 }, async () => (await f.handler(request("GET"), { id: job.id })).json()));
  assert.ok(receipts.some((receipt) => receipt.state === "SUCCEEDED"));
  assert.equal(f.calls.check, 9); assert.equal(f.calls.submit, 1);
});
test("result is binary and no-store, only successful owned jobs may retrieve it", async () => {
  const f = fixture(); const job = await (await f.handler(request())).json();
  assert.equal((await f.handler(request("GET"), { id: job.id, result: true })).status, 409);
  await f.handler(request("GET"), { id: job.id });
  const response = await f.handler(request("GET"), { id: job.id, result: true });
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([255, 216, 255, 0]));
  assert.equal(f.calls.submit, 1);
});
test("already aborted caller cannot create a receipt or upstream job; non-durable fallback fails closed", async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  assert.equal((await f.handler(request("POST", body, "fixture-key", abort.signal))).status, 408);
  assert.equal(f.calls.submit, 0);
  assert.throws(() => createHordeJobRepository({ driver: "sql.js" }), /DURABLE_SQLITE_REQUIRED/);
  assert.equal(HORDE_POLL_TIMEOUT_MS, 25 * 60 * 1000);
});
test("reservation and updates fsync their commit then restore the gateway's prior SQLite durability setting", () => {
  const db = sqlite(); db.raw.exec("PRAGMA synchronous = NORMAL");
  const original = db.run;
  let fullWrites = 0;
  db.run = (sql, params) => {
    if (sql.startsWith("INSERT") || sql.startsWith("UPDATE")) {
      assert.equal(db.raw.prepare("PRAGMA synchronous").get().synchronous, 2);
      fullWrites++;
    }
    return original(sql, params);
  };
  const repository = createHordeJobRepository(db);
  assert.equal(repository.reserve({ id: "fixture", state: "SUBMITTING" }), true);
  repository.update("fixture", (job) => ({ ...job, state: "QUEUED" }));
  assert.equal(fullWrites, 2);
  assert.equal(db.raw.prepare("PRAGMA synchronous").get().synchronous, 1);
  db.raw.close();
});
test("synchronous compatibility waits beyond ten minutes and six transient errors without changing quality defaults", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
  let checks = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("/check/")) return ++checks < 130 ? Response.json({}, { status: 429 }) : Response.json({ done: true, faulted: false });
    return Response.json({ done: true, generations: [{ img: "https://imgen.aihorde.net/fixture.webp" }] });
  });
  const pending = hordeAdapter.parseResponse(Response.json({ id: upstreamId }), { headers: {} });
  for (let index = 0; index < 131; index++) {
    // Drain promise continuations before advancing the next scheduled poll.
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    t.mock.timers.tick(5000);
  }
  assert.equal((await pending).done, true);
  assert.equal(checks, 130);
  assert.ok(Date.now() - 100000 > 10 * 60 * 1000);
  t.mock.timers.reset();
});

const jsonResponse = (value, status = 200) => Response.json(value, { status });
const providerFixture = (values) => {
  const calls = [];
  return { calls, provider: createHordeJobProvider({ fetchFn: async (...args) => { calls.push(args); const value = values.shift(); if (value instanceof Error) throw value; return value; } }) };
};
test("provider submission preserves original quality defaults and never retries ambiguous acceptance", async () => {
  const f = providerFixture([jsonResponse({ id: upstreamId })]);
  assert.deepEqual(await f.provider.submit("stable_diffusion", "quiet", { apiKey: "fixture-upstream" }), { state: "QUEUED", upstreamId });
  const sent = JSON.parse(f.calls[0][1].body);
  assert.equal(sent.params.steps, 30); assert.equal(sent.params.cfg_scale, 7); assert.equal(sent.params.sampler_name, "k_euler_a");
  assert.equal(sent.params.n, 1); assert.equal(f.calls[0][1].redirect, "error");
  const malformed = providerFixture([jsonResponse({ id: "missing" })]);
  assert.equal((await malformed.provider.submit("stable_diffusion", "quiet", {})).state, "UNKNOWN");
  assert.equal(malformed.calls.length, 1);
});
test("provider rate rejection, unknown server error, confirmed expiry and malformed checks stay distinct", async () => {
  for (const [status, state] of [[429, "FAILED"], [500, "UNKNOWN"]]) {
    const f = providerFixture([jsonResponse({}, status)]);
    assert.equal((await f.provider.submit("stable_diffusion", "quiet", {})).state, state);
    assert.equal(f.calls.length, 1);
  }
  const expired = providerFixture([jsonResponse({}, 404)]);
  assert.equal((await expired.provider.check(upstreamId, {})).error, "PROVIDER_JOB_EXPIRED");
  const temporary = providerFixture([jsonResponse({}, 429)]);
  await assert.rejects(temporary.provider.check(upstreamId, {}), /STATUS_UNAVAILABLE/);
  const malformed = providerFixture([jsonResponse({})]);
  await assert.rejects(malformed.provider.check(upstreamId, {}), /INVALID_PROVIDER_STATUS/);
  const valid = providerFixture([jsonResponse({ done: false, faulted: false, processing: 1, queue_position: 3, wait_time: 900 })]);
  assert.deepEqual(await valid.provider.check(upstreamId, {}), { state: "RUNNING", progress: { queuePosition: 3, waitSeconds: 900, processing: 1 } });
});
const readyStatus = (url) => jsonResponse({ done: true, faulted: false, generations: [{ img: url }] });
test("result rejects local/credential/foreign URLs before fetching and never follows redirects", async () => {
  for (const url of ["http://127.0.0.1/image", "https://localhost/image", "https://imgen.aihorde.net.evil.test/x", "https://x@imgen.aihorde.net/x", "https://imgen.aihorde.net:8443/x", "https://another-account.r2.cloudflarestorage.com/x", "https://a223539ccf6caa2d76459c9727d276e6.r2.cloudflarestorage.com.evil.test/x"]) {
    const f = providerFixture([readyStatus(url)]);
    await assert.rejects(f.provider.result(upstreamId, {}), /UNSAFE_RESULT_URL/); assert.equal(f.calls.length, 1);
  }
  const f = providerFixture([readyStatus("https://imgen.aihorde.net/a.webp"), new Error("redirect blocked")]);
  await assert.rejects(f.provider.result(upstreamId, {}), /redirect blocked/);
  assert.equal(f.calls[1][1].redirect, "error"); assert.equal(f.calls[1][1].headers, undefined);
});
test("result accepts the official Horde R2 account's presigned image without exposing upstream credentials", async () => {
  const url = "https://a223539ccf6caa2d76459c9727d276e6.r2.cloudflarestorage.com/horde-transient/fixture.webp?X-Amz-Signature=fixture";
  const bytes = Buffer.from("RIFF1234WEBPfixture");
  const f = providerFixture([readyStatus(url), new Response(bytes, { headers: { "content-type": "image/webp" } })]);
  assert.deepEqual(await f.provider.result(upstreamId, { apiKey: "private-fixture-key" }), { bytes, contentType: "image/webp" });
  assert.equal(f.calls[1][0], url);
  assert.equal(f.calls[1][1].redirect, "error");
  assert.equal(f.calls[1][1].headers, undefined);
});
test("result enforces declared and streamed size plus content type and file signature", async () => {
  const cases = [
    new Response("x", { headers: { "content-type": "image/png", "content-length": String(HORDE_MAX_IMAGE_BYTES + 1) } }),
    new Response("<html>", { headers: { "content-type": "text/html" } }),
    new Response("not a png", { headers: { "content-type": "image/png" } }),
    new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(HORDE_MAX_IMAGE_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close(); } }), { headers: { "content-type": "image/png" } }),
  ];
  for (const response of cases) {
    const f = providerFixture([readyStatus("https://imgen.aihorde.net/test.webp"), response]);
    await assert.rejects(f.provider.result(upstreamId, {}), /RESPONSE_TOO_LARGE|INVALID_IMAGE/);
  }
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const f = providerFixture([readyStatus("https://imgen.aihorde.net/a.png"), new Response(bytes, { headers: { "content-type": "image/png" } })]);
  assert.deepEqual(await f.provider.result(upstreamId, {}), { bytes, contentType: "image/png" });
});
test("production direct-model route refuses a restricted key's colliding combo permission before dispatch", async () => {
  const state = { db: sqlite(), allow: [body.model], submissions: 0 };
  globalThis.__hordeRouteFixture = state;
  const modules = new Map([
    ["@/lib/db/driver.js", "export const getAdapter = async () => globalThis.__hordeRouteFixture.db;"],
    ["@/lib/localDb.js", `export const validateApiKey = async () => true;
      export const getProviderConnections = async () => [{id:'pinned',provider:'aihorde',isActive:true}];
      export const getProviderConnectionById = async () => ({id:'pinned',provider:'aihorde',isActive:true});`],
    ["@/lib/db/repos/disabledModelsRepo.js", "export const getDisabledByProvider = async () => [];"],
    ["@/lib/db/repos/apiKeysRepo.js", `export const getApiKeyByKey = async () => ({id:'key',name:'fixture',access:{restricted:true,allow:globalThis.__hordeRouteFixture.allow}});`],
    ["@/lib/db/repos/combosRepo.js", `export const getCombos = async () => [{name:${JSON.stringify(body.model)}}];`],
    ["@/shared/constants/providers.js", "export const resolveProviderId = (p) => p;"],
    ["open-sse/utils/error.js", "export const errorResponse = (status,message) => Response.json({error:message},{status});"],
    ["fixture:auth", "export const getProviderCredentials = async () => ({connectionId:'pinned'});"],
    ["fixture:model", `export const getModelInfo = async () => ({provider:'aihorde',model:'stable_diffusion'});
      export const getComboModels = async (name) => name === ${JSON.stringify(body.model)} ? ['aihorde/Deliberate'] : null;`],
    ["fixture:logger", "export const warn = () => {}; export const info = () => {};"],
    ["fixture:provider", `export const createHordeJobProvider = () => ({submit:async () => {
      globalThis.__hordeRouteFixture.submissions++; return {state:'QUEUED',upstreamId:${JSON.stringify(upstreamId)}};}});`],
  ]);
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      let key = specifier;
      if (context.parentURL?.endsWith("/src/sse/handlers/imageJobs.js")) {
        if (specifier === "../services/auth.js") key = "fixture:auth";
        if (specifier.endsWith("/imageProviders/hordeJobs.js")) key = "fixture:provider";
      }
      if (context.parentURL?.endsWith("/src/sse/services/keyAccess.js")) {
        if (specifier === "./model.js") key = "fixture:model";
        if (specifier === "../utils/logger.js") key = "fixture:logger";
      }
      if (modules.has(key)) return { url: `data:text/javascript,${encodeURIComponent(modules.get(key))}`, shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../../src/${specifier.slice(2)}`, import.meta.url).href, context);
      if (specifier.startsWith("open-sse/")) return next(new URL(`../../${specifier}`, import.meta.url).href, context);
      return next(specifier, context);
    },
  });
  try {
    const { handleImageJob } = await import("../../src/sse/handlers/imageJobs.js");
    const denied = await handleImageJob(request());
    assert.equal(denied.status, 403);
    assert.equal(state.submissions, 0);
    assert.equal(state.db.raw.prepare("SELECT COUNT(*) AS n FROM kv").get().n, 0);
    state.allow = ["direct-approved"];
    assert.equal((await handleImageJob(request())).status, 202);
    assert.equal(state.submissions, 1);
  } finally {
    hooks.deregister(); state.db.raw.close(); delete globalThis.__hordeRouteFixture;
  }
});
