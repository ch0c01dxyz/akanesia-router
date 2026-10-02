import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  REDACTED,
  REPLAY_DEFAULT_MAX_BYTES,
  REPLAY_BODY_MAX_CHARS,
  redactHeaders,
  redactJsonValue,
  redactBody,
  redactUrl,
  truncateText,
  estimateBytes,
  captureReplayEntry,
  listReplayEntries,
  getReplayEntry,
  clearReplayLog,
  setReplayMaxBytes,
  redactSecretValues,
  kumpulkanSecretValues,
  getReplayStats,
} from "../../src/lib/requestReplayBuffer.js";

beforeEach(() => {
  clearReplayLog();
});

afterEach(() => {
  clearReplayLog();
  setReplayMaxBytes(REPLAY_DEFAULT_MAX_BYTES);
});

describe("redactHeaders", () => {
  it("me-redact header sensitif (case-insensitive)", () => {
    const out = redactHeaders({
      Authorization: "Bearer sk-secret",
      COOKIE: "session=abc",
      "Set-Cookie": "a=b",
      "X-API-Key": "key123",
      "x-auth-token": "tok",
      "Proxy-Authorization": "Basic xyz",
      "Content-Type": "application/json",
      "X-Custom": "boleh",
    });
    for (const k of ["Authorization", "COOKIE", "Set-Cookie", "X-API-Key", "x-auth-token", "Proxy-Authorization"]) {
      expect(out[k]).toBe(REDACTED);
    }
    expect(out["Content-Type"]).toBe("application/json");
    expect(out["X-Custom"]).toBe("boleh");
  });

  it("tidak memutasi objek asli dan aman untuk input non-objek", () => {
    const asal = { Authorization: "Bearer x" };
    redactHeaders(asal);
    expect(asal.Authorization).toBe("Bearer x");
    expect(redactHeaders(null)).toEqual({});
    expect(redactHeaders("bukan-objek")).toEqual({});
  });
});

describe("redactJsonValue / redactBody", () => {
  it("me-redact key sensitif rekursif termasuk api_key", () => {
    const out = redactJsonValue({
      password: "p4ss",
      nested: { secret: "s3cr3t", access_token: "at", refresh_token: "rt", api_key: "sk-live" },
      API_KEY: "kapital",
      arr: [{ password: "x" }],
      biasa: "tetap",
    });
    expect(out.password).toBe(REDACTED);
    expect(out.nested.secret).toBe(REDACTED);
    expect(out.nested.access_token).toBe(REDACTED);
    expect(out.nested.refresh_token).toBe(REDACTED);
    expect(out.nested.api_key).toBe(REDACTED);
    expect(out.API_KEY).toBe(REDACTED);
    expect(out.arr[0].password).toBe(REDACTED);
    expect(out.biasa).toBe("tetap");
  });

  it("redactBody menerima objek dan string JSON", () => {
    const obj = redactBody({ model: "m", api_key: "sk-abc" });
    expect(obj).not.toContain("sk-abc");
    expect(obj).toContain(REDACTED);
    const str = redactBody('{"password":"rahasia","model":"m"}');
    expect(str).not.toContain("rahasia");
    expect(JSON.parse(str).model).toBe("m");
  });

  it("redactBody aman untuk string non-JSON berpola sensitif", () => {
    const out = redactBody('kirim dengan "api_key": "sk-nempel" ya');
    expect(out).not.toContain("sk-nempel");
    expect(out).toContain(REDACTED);
  });

  it("redactBody aman untuk null/undefined/circular", () => {
    expect(redactBody(null)).toBe("");
    expect(redactBody(undefined)).toBe("");
    const c = { a: 1 };
    c.self = c;
    expect(() => redactBody(c)).not.toThrow();
  });
});

describe("redactUrl", () => {
  it("me-redact value query param sensitif", () => {
    const out = redactUrl("https://api.example.com/v1/chat?key=SECRET123&model=m&token=abc");
    expect(out).not.toContain("SECRET123");
    expect(out).not.toContain("token=abc");
    expect(out).toContain("model=m");
    expect(out).toContain(REDACTED);
  });

  it("aman untuk URL invalid", () => {
    expect(redactUrl("bukan url")).toBe("bukan url");
    expect(redactUrl(null)).toBe("");
  });
});

describe("truncateText / estimateBytes", () => {
  it("memotong teks berlebih dengan flag", () => {
    const { text, truncated } = truncateText("abcdef", 4);
    expect(text).toBe("abcd");
    expect(truncated).toBe(true);
    expect(truncateText("ab", 4).truncated).toBe(false);
  });

  it("estimateBytes menghitung UTF-8", () => {
    expect(estimateBytes("abc")).toBe(3);
    expect(estimateBytes("é")).toBe(2);
  });
});

describe("buffer: capture/list/get/clear", () => {
  it("capture menyimpan entry dan list terbaru dulu", () => {
    const e1 = captureReplayEntry({ provider: "p", model: "m1", status: 500, requestBody: { a: 1 } });
    const e2 = captureReplayEntry({ provider: "p", model: "m2", status: 429, requestBody: { a: 2 } });
    expect(e1.id).not.toBe(e2.id);
    const daftar = listReplayEntries();
    expect(daftar.map((e) => e.id)).toEqual([e2.id, e1.id]);
    expect(getReplayEntry(e1.id).model).toBe("m1");
    expect(getReplayEntry("tidak-ada")).toBeNull();
  });

  it("capture tidak pernah throw untuk input sampah", () => {
    expect(captureReplayEntry(null)).toBeNull();
    expect(captureReplayEntry("string")).toBeNull();
    const e = captureReplayEntry({});
    expect(e.provider).toBe("");
    expect(e.status).toBe(0);
  });

  it("clear mengosongkan buffer", () => {
    captureReplayEntry({ provider: "p", requestBody: {} });
    clearReplayLog();
    expect(listReplayEntries()).toEqual([]);
    expect(getReplayStats().count).toBe(0);
  });

  it("request body di-truncate ~64KB", () => {
    const besar = "x".repeat(REPLAY_BODY_MAX_CHARS + 1000);
    const e = captureReplayEntry({ provider: "p", requestBody: besar });
    expect(e.requestBody.length).toBeLessThanOrEqual(REPLAY_BODY_MAX_CHARS);
    expect(e.requestBodyTruncated).toBe(true);
  });

  it("errorOrigin: provider/gateway disimpan, nilai lain jadi unknown", () => {
    const e1 = captureReplayEntry({ provider: "p", model: "m", status: 500, errorOrigin: "provider", requestBody: {} });
    const e2 = captureReplayEntry({ provider: "p", model: "m", status: 502, errorOrigin: "gateway", requestBody: {} });
    const e3 = captureReplayEntry({ provider: "p", model: "m", status: 502, requestBody: {} });
    const e4 = captureReplayEntry({ provider: "p", model: "m", status: 500, errorOrigin: "sembarang", requestBody: {} });
    expect(e1.errorOrigin).toBe("provider");
    expect(e2.errorOrigin).toBe("gateway");
    expect(e3.errorOrigin).toBe("unknown");
    expect(e4.errorOrigin).toBe("unknown");
    // Field ikut terdaftar di list (untuk tampilan UI & export JSON).
    const daftar = listReplayEntries();
    expect(daftar.map((e) => e.errorOrigin)).toEqual(["unknown", "unknown", "gateway", "provider"]);
  });
});

describe("buffer: byte cap drop-oldest", () => {
  it("tidak pernah melewati batas dan membuang yang terlama", () => {
    setReplayMaxBytes(3000);
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const e = captureReplayEntry({
        provider: "p",
        model: `m${i}`,
        status: 500,
        requestBody: { data: "y".repeat(400), idx: i },
      });
      ids.push(e.id);
    }
    const stats = getReplayStats();
    expect(stats.bytesUsed).toBeLessThanOrEqual(3000);
    expect(stats.count).toBeLessThan(10);
    const sisa = listReplayEntries();
    // Yang tersisa adalah entry TERBARU
    const sisaIds = new Set(sisa.map((e) => e.id));
    expect(sisaIds.has(ids[9])).toBe(true);
    expect(sisaIds.has(ids[0])).toBe(false);
  });

  it("setReplayMaxBytes langsung trim buffer yang ada", () => {
    for (let i = 0; i < 5; i++) {
      captureReplayEntry({ provider: "p", requestBody: { data: "z".repeat(500) } });
    }
    setReplayMaxBytes(1500);
    expect(getReplayStats().bytesUsed).toBeLessThanOrEqual(1500);
  });

  it("nilai tidak valid diabaikan", () => {
    const sebelum = getReplayStats().maxBytes;
    setReplayMaxBytes(0);
    setReplayMaxBytes(-5);
    setReplayMaxBytes("bukan-angka");
    expect(getReplayStats().maxBytes).toBe(sebelum);
  });
});

describe("kriteria terima: tidak ada secret bocor", () => {
  it("responseText dan error juga di-redact (upstream bisa menggemakan request)", () => {
    const e = captureReplayEntry({
      provider: "p",
      status: 400,
      requestBody: { model: "m" },
      responseText: '{"error":"bad key","echo":{"api_key":"sk-echo-123"}}',
      error: 'gagal dengan token "access_token": "at-echo-456"',
    });
    expect(JSON.stringify(e)).not.toContain("sk-echo-123");
    expect(JSON.stringify(e)).not.toContain("at-echo-456");
    expect(e.responseText).toContain(REDACTED);
  });

  it("API key di header/body/URL tidak muncul di entry", () => {
    const e = captureReplayEntry({
      provider: "openai",
      model: "gpt-x",
      connectionId: "conn-1",
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions?api_key=QUERYSECRET",
      status: 401,
      requestHeaders: {
        Authorization: "Bearer sk-live-12345",
        "x-api-key": "k-999",
        "Content-Type": "application/json",
      },
      requestBody: { model: "gpt-x", api_key: "sk-nempel-di-body", messages: [] },
      responseText: "invalid api key",
      error: "invalid api key",
    });
    const serial = JSON.stringify(e);
    for (const rahasia of ["sk-live-12345", "k-999", "sk-nempel-di-body", "QUERYSECRET"]) {
      expect(serial).not.toContain(rahasia);
    }
    expect(e.requestHeaders.Authorization).toBe(REDACTED);
    expect(e.url).toContain(REDACTED);
    // Koneksi ID tetap tersimpan (bukan secret, dibutuhkan untuk replay)
    expect(e.connectionId).toBe("conn-1");
  });
});

describe("redactSecretValues / kumpulkanSecretValues", () => {
  const SECRET = "sk-RAHASIA-1234567890";

  it("me-redact kemunculan secret di free-text (body, response, error, url)", () => {
    clearReplayLog();
    const e = captureReplayEntry({
      provider: "p",
      model: "m",
      url: "https://x.test/v1",
      requestHeaders: {},
      requestBody: { messages: [{ content: "kunciku " + SECRET + " tolong" }] },
      responseText: "invalid key " + SECRET + " rejected",
      error: "gagal auth " + SECRET,
      secretValues: [SECRET],
    });
    const dump = JSON.stringify(e);
    expect(dump).not.toContain(SECRET);
    expect(e.requestBody).toContain(REDACTED);
    expect(e.responseText).toContain(REDACTED);
    expect(e.error).toContain(REDACTED);
  });

  it("secretValues tidak pernah disimpan mentah", () => {
    clearReplayLog();
    const e = captureReplayEntry({
      provider: "p",
      model: "m",
      requestBody: { a: 1 },
      secretValues: [SECRET],
    });
    expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it("string pendek (< 8) dan non-string diabaikan", () => {
    expect(redactSecretValues("abc abc", ["abc"])).toBe("abc abc");
    expect(redactSecretValues("teks", null)).toBe("teks");
    expect(redactSecretValues("teks", [123])).toBe("teks");
  });

  it("kumpulkanSecretValues mengambil apiKey, token, dan custom header", () => {
    const vals = kumpulkanSecretValues({
      apiKey: SECRET,
      accessToken: "tok-ACCESS-abcdefg",
      refreshToken: "pendek",
      providerSpecificData: {
        customHeaders: [{ name: "X-Custom", value: "custom-SECRET-xyz" }],
      },
    });
    expect(vals).toContain(SECRET);
    expect(vals).toContain("tok-ACCESS-abcdefg");
    expect(vals).toContain("custom-SECRET-xyz");
    expect(vals).not.toContain("pendek");
  });

  it("kumpulkanSecretValues aman untuk input kosong/aneh", () => {
    expect(kumpulkanSecretValues(null)).toEqual([]);
    expect(kumpulkanSecretValues({})).toEqual([]);
    expect(kumpulkanSecretValues({ providerSpecificData: { customHeaders: "bukan array" } })).toEqual([]);
  });
});
