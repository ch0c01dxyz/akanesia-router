/**
 * cursor-api: crsr_ API key → session token 1-jam (di-cache).
 * - exchange: bentuk request, mapping error, tanpa bocor key
 * - cache: resolve kedua tidak hit exchange; token expired → tukar ulang
 * - executor: key ditukar sebelum dial, header tak pernah membawa key mentah,
 *   kredensial OAuth lewat tanpa perubahan
 * - wiring: registry entry, alias cua, adapter defs
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  CURSOR_API_KEY_EXCHANGE_URL,
  CursorApiKeyExchangeError,
  __resetCursorApiKeyAuthForTest,
  exchangeCursorApiKey,
  isCursorApiKey,
  readJwtExpiryMs,
  resolveCursorSessionToken,
} from "../../open-sse/services/cursorApiKeyAuth.js";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { ADAPTER_DEFS } from "../../open-sse/executors/adapterDefs.js";
import cursorApiEntry from "../../open-sse/providers/registry/cursor-api.js";

const API_KEY = "crsr_test_key_0123456789";

function jwt(expSeconds) {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ exp: expSeconds, type: "api_key_token" })}.sig`;
}

function okExchange(exp) {
  return new Response(
    JSON.stringify({ accessToken: jwt(exp), refreshToken: jwt(exp) }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("cursorApiKeyAuth", () => {
  beforeEach(() => __resetCursorApiKeyAuthForTest());

  it("mengenali key crsr_ saja", () => {
    expect(isCursorApiKey(API_KEY)).toBe(true);
    expect(isCursorApiKey("sk-other")).toBe(false);
    expect(isCursorApiKey(undefined)).toBe(false);
  });

  it("membaca exp dari JWT, null untuk token opaque", () => {
    expect(readJwtExpiryMs(jwt(1_800_000_000))).toBe(1_800_000_000_000);
    expect(readJwtExpiryMs("opaque")).toBe(null);
  });

  it("POST key sebagai Bearer ke endpoint exchange dan memakai exp JWT", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return okExchange(exp);
    };
    const session = await exchangeCursorApiKey(API_KEY, { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(CURSOR_API_KEY_EXCHANGE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(calls[0].init.body).toBe("{}");
    expect(session.accessToken).toBe(jwt(exp));
    expect(session.expiresAt).toBe(exp * 1000);
  });

  it("menolak key non-crsr tanpa memanggil upstream", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return okExchange(1); };
    await expect(exchangeCursorApiKey("sk-not-cursor", { fetchImpl }))
      .rejects.toThrowError(CursorApiKeyExchangeError);
    await expect(exchangeCursorApiKey("sk-not-cursor", { fetchImpl }))
      .rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
  });

  it("memetakan 401/403 menjadi error 401 tanpa membocorkan key", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = async () => new Response("nope", { status });
      const err = await exchangeCursorApiKey(API_KEY, { fetchImpl }).catch((e) => e);
      expect(err).toBeInstanceOf(CursorApiKeyExchangeError);
      expect(err.status).toBe(401);
      expect(err.message).not.toContain(API_KEY);
    }
  });

  it("memetakan 5xx dan body malformed menjadi 502", async () => {
    const cases = [
      () => new Response("boom", { status: 503 }),
      () => new Response("not json", { status: 200 }),
      () => new Response(JSON.stringify({ refreshToken: "x" }), { status: 200 }),
    ];
    for (const respond of cases) {
      const err = await exchangeCursorApiKey(API_KEY, { fetchImpl: respond }).catch((e) => e);
      expect(err.status).toBe(502);
    }
  });

  it("me-cache token: resolve kedua tidak hit exchange", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    let calls = 0;
    const fetchImpl = async () => { calls++; return okExchange(exp); };
    const first = await resolveCursorSessionToken(API_KEY, { fetchImpl });
    const second = await resolveCursorSessionToken(API_KEY, { fetchImpl });
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it("resolve konkuren berbagi satu exchange (singleflight)", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return okExchange(exp);
    };
    const [a, b] = await Promise.all([
      resolveCursorSessionToken(API_KEY, { fetchImpl }),
      resolveCursorSessionToken(API_KEY, { fetchImpl }),
    ]);
    expect(calls).toBe(1);
    expect(a.accessToken).toBe(b.accessToken);
  });

  it("token expired → tukar ulang", async () => {
    const t0 = Date.now();
    const exp1 = Math.floor(t0 / 1000) + 3600;
    const exp2 = Math.floor(t0 / 1000) + 7200;
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return okExchange(calls === 1 ? exp1 : exp2);
    };
    const first = await resolveCursorSessionToken(API_KEY, { fetchImpl, now: () => t0 });
    // Lewati exp + skew 5 menit → cache dianggap basi
    const second = await resolveCursorSessionToken(API_KEY, {
      fetchImpl,
      now: () => t0 + 2 * 3600 * 1000,
    });
    expect(calls).toBe(2);
    expect(second.accessToken).toBe(jwt(exp2));
    expect(second.accessToken).not.toBe(first.accessToken);
  });
});

describe("CursorExecutor credential resolution", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => __resetCursorApiKeyAuthForTest());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    __resetCursorApiKeyAuthForTest();
  });

  it("menukar crsr_ key dan mengirim session JWT, bukan key mentah", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const calls = [];
    globalThis.fetch = (async (input) => {
      calls.push(String(input));
      return okExchange(exp);
    });

    const executor = new CursorExecutor("cursor-api");
    const resolved = await executor.resolveExecutionCredentials({
      apiKey: API_KEY,
      providerSpecificData: {},
    });
    expect(resolved).not.toBeInstanceOf(Response);
    const headers = executor.buildHeaders(resolved);
    expect(headers.authorization).toBe(`Bearer ${jwt(exp)}`);
    expect(headers.authorization).not.toContain(API_KEY);
    expect(JSON.stringify(headers)).not.toContain(API_KEY);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/auth\/exchange_user_api_key$/);
    // machineId deterministik dari key agar header stabil
    expect(resolved.providerSpecificData.machineId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("memakai cache: request kedua tidak menukar ulang", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return okExchange(exp);
    });
    const executor = new CursorExecutor("cursor-api");
    await executor.resolveExecutionCredentials({ apiKey: API_KEY, providerSpecificData: {} });
    await executor.resolveExecutionCredentials({ apiKey: API_KEY, providerSpecificData: {} });
    expect(calls).toBe(1);
  });

  it("mengembalikan Response 401 tersanitasi bila Cursor menolak key", async () => {
    globalThis.fetch = (async () => new Response("bad key", { status: 401 }));
    const executor = new CursorExecutor("cursor-api");
    const resolved = await executor.resolveExecutionCredentials({ apiKey: API_KEY });
    expect(resolved).toBeInstanceOf(Response);
    expect(resolved.status).toBe(401);
    const body = await resolved.json();
    expect(body.error.type).toBe("authentication_error");
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it("membiarkan kredensial OAuth tanpa perubahan dan tanpa exchange", async () => {
    globalThis.fetch = (async () => {
      throw new Error("exchange must not be called");
    });
    const executor = new CursorExecutor();
    const credentials = {
      accessToken: "user_01::ide.session.jwt",
      providerSpecificData: { machineId: "m123" },
    };
    const resolved = await executor.resolveExecutionCredentials(credentials);
    expect(resolved).toBe(credentials);
    expect(executor.getProvider()).toBe("cursor");
  });
});

describe("cursor-api wiring", () => {
  it("registry entry: id cursor-api, alias cua, kategori apikey", () => {
    expect(cursorApiEntry.id).toBe("cursor-api");
    expect(cursorApiEntry.alias).toBe("cua");
    expect(cursorApiEntry.category).toBe("apikey");
    expect(cursorApiEntry.authType).toBe("apikey");
    expect(cursorApiEntry.transport.baseUrl).toContain("api2.cursor.sh");
    expect(cursorApiEntry.transport.format).toBe("cursor");
    expect(cursorApiEntry.models.length).toBeGreaterThan(0);
  });

  it("alias cua ter-resolve ke cursor-api", () => {
    expect(resolveProviderAlias("cua")).toBe("cursor-api");
    expect(resolveProviderAlias("cursor-api")).toBe("cursor-api");
  });

  it("PROVIDERS memuat cursor-api dari transport cursor", () => {
    expect(PROVIDERS["cursor-api"]).toBeDefined();
    expect(PROVIDERS["cursor-api"].baseUrl).toBe(PROVIDERS.cursor.baseUrl);
    expect(PROVIDERS["cursor-api"].format).toBe("cursor");
  });

  it("adapter defs me-routing cursor-api dan cua ke CursorExecutor", () => {
    for (const id of ["cursor-api", "cua"]) {
      expect(ADAPTER_DEFS[id]).toBeDefined();
      expect(ADAPTER_DEFS[id].file).toBe("./cursor.js");
      expect(ADAPTER_DEFS[id].exportName).toBe("CursorExecutor");
      expect(ADAPTER_DEFS[id].args).toEqual(["cursor-api"]);
    }
    const executor = new CursorExecutor("cursor-api");
    expect(executor).toBeInstanceOf(CursorExecutor);
    expect(executor.getProvider()).toBe("cursor-api");
  });
});
