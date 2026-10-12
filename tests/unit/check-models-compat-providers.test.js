import { describe, it, expect, vi } from "vitest";
import { checkViaConnectionBaseUrl } from "../../src/app/api/providers/check-models/route.js";

const openaiConn = {
  id: "conn-1",
  provider: "openai-compatible-chat-abc123",
  name: "My Custom LLM",
  apiKey: "sk-test",
  providerSpecificData: { baseUrl: "https://llm.example.com/v1/" },
};

const anthropicConn = {
  id: "conn-2",
  provider: "anthropic-compatible-chat-def456",
  name: "My Claude Proxy",
  apiKey: "sk-test",
  providerSpecificData: { baseUrl: "https://proxy.example.com/v1/messages" },
};

function okFetch(json) {
  return vi.fn(async () => ({ ok: true, json: async () => json }));
}

describe("checkViaConnectionBaseUrl", () => {
  it("null bila provider bukan kompatibel dinamis", async () => {
    const r = await checkViaConnectionBaseUrl("openai", openaiConn, okFetch({ data: [] }));
    expect(r).toBeNull();
  });

  it("null bila koneksi tidak punya baseUrl", async () => {
    const r = await checkViaConnectionBaseUrl(
      "openai-compatible-chat-abc123",
      { ...openaiConn, providerSpecificData: {} },
      okFetch({ data: [] })
    );
    expect(r).toBeNull();
  });

  it("API key kosong → skipped dengan warning tambah API key", async () => {
    const fetchFn = vi.fn();
    const r = await checkViaConnectionBaseUrl(
      "openai-compatible-chat-abc123",
      { ...openaiConn, apiKey: "" },
      fetchFn
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(true);
    expect(r.reason).toContain("API key belum diatur");
  });

  it("tanpa apiKey sama sekali → skipped dengan warning", async () => {
    const fetchFn = vi.fn();
    const { apiKey: _dropped, ...noKey } = openaiConn;
    const r = await checkViaConnectionBaseUrl("openai-compatible-chat-abc123", noKey, fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(r.skipped).toBe(true);
    expect(r.reason).toContain("tambahkan API key");
  });

  it("cek {baseUrl}/models dengan Bearer untuk openai-compatible", async () => {
    const fetchFn = okFetch({ data: [{ id: "m1" }, { id: "m2" }] });
    const r = await checkViaConnectionBaseUrl("openai-compatible-chat-abc123", openaiConn, fetchFn);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe("https://llm.example.com/v1/models");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    expect(r.ok).toBe(true);
    expect(r.modelCount).toBe(2);
    expect(r.models).toEqual(["m1", "m2"]);
    expect(r.source).toBe("connection");
    expect(r.name).toBe("My Custom LLM");
  });

  it("strip suffix /messages untuk anthropic-compatible", async () => {
    const fetchFn = okFetch({ data: [{ id: "c1" }] });
    const r = await checkViaConnectionBaseUrl("anthropic-compatible-chat-def456", anthropicConn, fetchFn);
    const [url, opts] = fetchFn.mock.calls[0];
    expect(url).toBe("https://proxy.example.com/v1/models");
    expect(opts.headers["x-api-key"]).toBe("sk-test");
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["c1"]);
  });

  it("HTTP error → ok:false dengan pesan status", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid key" }));
    const r = await checkViaConnectionBaseUrl("openai-compatible-chat-abc123", openaiConn, fetchFn);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("HTTP 401");
    expect(r.httpStatus).toBe(401);
    expect(r.errorBody).toBe("invalid key");
  });

  it("HTTP 403 + suspend → sinyal terdeteksi via isSuspensionSignal", async () => {
    const { isSuspensionSignal } = await import("../../open-sse/utils/accountSuspension.js");
    const fetchFn = vi.fn(async () => ({ ok: false, status: 403, text: async () => "account suspended" }));
    const r = await checkViaConnectionBaseUrl("openai-compatible-chat-abc123", openaiConn, fetchFn);
    expect(r.ok).toBe(false);
    expect(isSuspensionSignal(r.httpStatus, r.errorBody)).toBe(true);
  });

  it("network error → ok:false dengan pesan error", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("fetch failed"); });
    const r = await checkViaConnectionBaseUrl("openai-compatible-chat-abc123", openaiConn, fetchFn);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("fetch failed");
  });
});
