// Matriks routing offline untuk model opencode-go.
//
// Menjalankan guard handleChatCore ASLI + resolusi targetFormat
// (open-sse/handlers/chatCore.js) end-to-end; hanya respons HTTP executor yang
// di-mock. Target assertion adalah credentials.runtimeTransport — field yang
// dibaca DefaultExecutor.buildUrl/buildHeaders untuk memilih endpoint dan skema
// auth — sehingga keputusan guard yang salah muncul sebagai baseUrl yang salah,
// sama seperti di wire aslinya.
//
// Sel:
//   - deepseek × {openai, claude, openai-responses} × {polos, (max)} — matriks
//     endpoint yang diperdebatkan di #3278/#3332. Sel polos dan bersuffix harus
//     resolve identik.
//   - glm/kimi (chat-only) + (max) — sel regresi: dengan suffix thinking, guard
//     di master di-bypass (suffix tidak di-strip sebelum lookup registry) dan
//     request di-route ke /messages yang tidak dilayani upstream.
//   - minimax + (max) + claude — suffix TIDAK boleh memblokir format yang
//     memang dideklarasikan.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("uuid", () => ({
  v4: () => "00000000-0000-4000-8000-000000000000",
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

// image.js mengimpor Agent dari "undici" (tidak terinstal di sebagian dev env);
// jalur prefetch tidak relevan untuk assertion routing.
vi.mock("../../open-sse/translator/concerns/image.js", () => ({
  encodeDataUri: (mimeType, base64) => `data:${mimeType};base64,${base64}`,
  parseDataUri: (url) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(url);
    return m ? { mimeType: m[1], base64: m[2] } : null;
  },
  fetchImageAsBase64: async () => null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const BASE = "https://opencode.ai/zen/go/v1";
const ENDPOINTS = {
  openai: `${BASE}/chat/completions`,
  claude: `${BASE}/messages`,
  "openai-responses": `${BASE}/responses`,
};

// Respons JSON provider non-stream minimal per format target — respons executor yang di-mock.
const RESPONSE_BY_FORMAT = {
  claude: {
    id: "msg_1", type: "message", role: "assistant", model: "test",
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  openai: {
    id: "chatcmpl-1", object: "chat.completion", model: "test",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  },
  "openai-responses": {
    id: "resp_1", object: "response", created_at: 0, status: "completed", model: "test",
    output: [{
      type: "message", id: "msg_1", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: "ok", annotations: [] }],
    }],
  },
};

async function route(model, sourceFormat) {
  executeMock.mockResolvedValueOnce({
    response: new Response(JSON.stringify(RESPONSE_BY_FORMAT[sourceFormat === "openai" ? "openai" : sourceFormat] || RESPONSE_BY_FORMAT.openai), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    url: ENDPOINTS[sourceFormat] || ENDPOINTS.openai,
    headers: {},
    transformedBody: null,
  });

  const credentials = { apiKey: "test-key", providerSpecificData: {} };
  const result = await handleChatCore({
    body: {
      model: `opencode-go/${model}`,
      stream: false,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    },
    modelInfo: { provider: "opencode-go", model },
    credentials,
    connectionId: "ocg-route-test",
    sourceFormatOverride: sourceFormat,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
  });

  const { credentials: creds } = executeMock.mock.calls.at(-1)[0];
  return { result, runtimeTransport: creds.runtimeTransport ?? null };
}

describe("matriks endpoint opencode-go DeepSeek (via handleChatCore asli)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
    for (const suffix of ["", "(max)"]) {
      const id = model + suffix;
      for (const [fmt, expectedUrl] of Object.entries(ENDPOINTS)) {
        it(`me-route ${id} + klien format-${fmt} ke ${expectedUrl}`, async () => {
          const { result, runtimeTransport } = await route(id, fmt);
          expect(result.success).toBe(true);
          expect(runtimeTransport?.baseUrl).toBe(expectedUrl);
        });
      }
    }
  }
});

describe("opencode-go thinking-suffix guard (regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TIDAK me-route glm-5.2(max) chat-only ke /messages pada request format claude", async () => {
    const { result, runtimeTransport } = await route("glm-5.2(max)", "claude");
    expect(result.success).toBe(true);
    expect(runtimeTransport).toBeNull(); // guard harus memblokir; fallback ke chat/completions
  });

  it("TIDAK me-route kimi-k2.6(max) chat-only ke /responses pada request format responses", async () => {
    const { result, runtimeTransport } = await route("kimi-k2.6(max)", "openai-responses");
    expect(result.success).toBe(true);
    expect(runtimeTransport).toBeNull();
  });

  it("tetap me-route minimax-m3(max) + klien format claude ke /messages", async () => {
    const { result, runtimeTransport } = await route("minimax-m3(max)", "claude");
    expect(result.success).toBe(true);
    expect(runtimeTransport?.baseUrl).toBe(ENDPOINTS.claude);
  });

  it("TIDAK me-route minimax-m3(max) (tanpa dukungan responses) ke /responses", async () => {
    const { result, runtimeTransport } = await route("minimax-m3(max)", "openai-responses");
    expect(result.success).toBe(true);
    expect(runtimeTransport).toBeNull();
  });
});
