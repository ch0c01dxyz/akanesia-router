// Regression test: Online Probe untuk provider KUSTOM
// (openai-compatible-chat-<uuid>, anthropic-compatible-chat-<uuid>).
//
// Bug: POST /api/probe/online mengembalikan 400
// {"error":"Provider tidak dikenal di registry"} untuk provider kustom
// karena lookup exact ke REGISTRY statis (320 entri) tidak pernah cocok
// dengan ID dinamis. Route kini membangun entri sintetis dari
// connection.providerSpecificData.baseUrl.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(),
}));
vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_providerId, credentials) => credentials),
}));

import { POST } from "@/app/api/probe/online/route.js";
import { getProviderConnections } from "@/models";
import { getProviderCredentials } from "@/sse/services/auth.js";

const CUSTOM_OPENAI_ID = "openai-compatible-chat-1ff5c946-f42e-4610-ac37-04b542321b21";
const CUSTOM_ANTHROPIC_ID = "anthropic-compatible-chat-9aa8b7c6-d5e4-4321-9876-abcdef123456";

function koneksiKustom(providerId, baseUrl) {
  return {
    id: "conn-kustom-1",
    provider: providerId,
    authType: "apikey",
    isActive: true,
    providerSpecificData: baseUrl == null ? {} : { baseUrl },
  };
}

function mockSukses(connection) {
  getProviderConnections.mockResolvedValue([connection]);
  getProviderCredentials.mockResolvedValue({ apiKey: "sk-test-upstream", connectionId: connection.id });
}

function mockBazaarStartRun(tangkap) {
  const fetchMock = vi.fn(async (_url, init) => {
    if (tangkap) tangkap.payload = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ runId: "run-test-123" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function reqJson(body) {
  return new Request("http://localhost/api/probe/online", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/probe/online — provider kustom", () => {
  let logSpy;
  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("provider openai-compatible kustom: start-run sukses dengan baseUrl koneksi + upstreamFormat openai", async () => {
    const conn = koneksiKustom(CUSTOM_OPENAI_ID, "https://api.example.com/v1");
    mockSukses(conn);
    const tangkap = {};
    mockBazaarStartRun(tangkap);

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "model-x" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.runId).toBe("run-test-123");
    expect(tangkap.payload.baseUrl).toBe("https://api.example.com/v1");
    expect(tangkap.payload.upstreamFormat).toBe("openai");
    expect(tangkap.payload.apiKey).toBe("sk-test-upstream");
    expect(tangkap.payload.modelId).toBe("model-x");
  });

  it("suffix /chat/completions pada baseUrl kustom di-strip sebelum dikirim", async () => {
    const conn = koneksiKustom(CUSTOM_OPENAI_ID, "https://api.example.com/v1/chat/completions");
    mockSukses(conn);
    const tangkap = {};
    mockBazaarStartRun(tangkap);

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "model-x" }));
    expect(res.status).toBe(200);
    expect(tangkap.payload.baseUrl).toBe("https://api.example.com/v1");
  });

  it("provider anthropic-compatible kustom: upstreamFormat anthropic", async () => {
    const conn = koneksiKustom(CUSTOM_ANTHROPIC_ID, "https://llm.example.net");
    mockSukses(conn);
    const tangkap = {};
    mockBazaarStartRun(tangkap);

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "claude-x" }));
    expect(res.status).toBe(200);
    expect(tangkap.payload.baseUrl).toBe("https://llm.example.net");
    expect(tangkap.payload.upstreamFormat).toBe("anthropic");
  });

  it("provider kustom tanpa baseUrl -> 400 Base URL belum dikonfigurasi", async () => {
    const conn = koneksiKustom(CUSTOM_OPENAI_ID, null);
    mockSukses(conn);
    mockBazaarStartRun();

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "model-x" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Base URL belum dikonfigurasi untuk provider kustom ini");
  });

  it("provider embedding kustom -> 400 probe tidak didukung", async () => {
    const conn = koneksiKustom("custom-embedding-abc123", "https://emb.example.com/v1");
    mockSukses(conn);
    mockBazaarStartRun();

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "embed-x" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Probe tidak didukung untuk provider embedding");
  });

  it("baseUrl localhost pada provider kustom tetap ditolak (harus HTTPS publik)", async () => {
    const conn = koneksiKustom(CUSTOM_OPENAI_ID, "http://localhost:8080/v1");
    mockSukses(conn);
    mockBazaarStartRun();

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "model-x" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Base URL harus HTTPS publik");
  });

  it("provider benar-benar tidak dikenal -> 400 pesan lama tetap dipertahankan", async () => {
    const conn = koneksiKustom("provider-aneh-tak-dikenal", "https://api.example.com/v1");
    mockSukses(conn);
    mockBazaarStartRun();

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "model-x" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Provider tidak dikenal di registry");
  });

  it("provider registry statis tetap bekerja (regresi: openai)", async () => {
    const conn = {
      id: "conn-openai-1",
      provider: "openai",
      authType: "apikey",
      isActive: true,
    };
    mockSukses(conn);
    const tangkap = {};
    mockBazaarStartRun(tangkap);

    const res = await POST(reqJson({ connectionId: conn.id, modelId: "gpt-4o-mini" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(tangkap.payload.upstreamFormat).toBe("openai");
  });
});
