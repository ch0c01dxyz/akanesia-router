// Urutan merge header: provider-level (settings.providerOverrides) vs
// node-level (ide #8, customHeaders per koneksi). Lock-in: node-level PALING
// SPESIFIK sehingga selalu menang bila nama header sama.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
const { DefaultExecutor } = await import("open-sse/executors/default.js");

let capturedHeaders = null;
beforeEach(() => {
  capturedHeaders = null;
  vi.mocked(proxyAwareFetch).mockImplementation(async (url, { headers }) => {
    capturedHeaders = { ...headers };
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

const credsWith = (customHeaders) => ({
  apiKey: "sk-node-key",
  providerSpecificData: {
    baseUrl: "https://example.com/v1",
    apiType: "chat",
    customHeaders,
  },
});

const runExecute = (credentials, providerOverrides) => {
  const executor = new DefaultExecutor("openai-compatible-chat", { baseUrl: "https://example.com/v1" });
  return executor.execute({
    model: "m",
    body: { model: "m", messages: [] },
    stream: false,
    credentials,
    providerOverrides,
  });
};

describe("urutan merge header provider-level vs node-level", () => {
  it("provider-level override diterapkan di atas header bawaan registry", async () => {
    await runExecute(credsWith([]), { headers: { "X-Provider-Level": "yes" } });
    expect(capturedHeaders["X-Provider-Level"]).toBe("yes");
    // Header bawaan executor tetap ada
    expect(capturedHeaders["Content-Type"]).toBeTruthy();
  });

  it("node-level (ide #8) menang atas provider-level bila nama sama", async () => {
    await runExecute(
      credsWith([{ name: "X-Shared", value: "node-menang" }]),
      { headers: { "X-Shared": "provider-kalah", "X-Only-Provider": "1" } }
    );
    expect(capturedHeaders["X-Shared"]).toBe("node-menang");
    expect(capturedHeaders["X-Only-Provider"]).toBe("1");
  });

  it("placeholder {{key}} node-level tetap ter-resolve setelah merge", async () => {
    await runExecute(
      credsWith([{ name: "X-Node-Key", value: "Token {{key}}" }]),
      { headers: { "X-Other": "v" } }
    );
    expect(capturedHeaders["X-Node-Key"]).toBe("Token sk-node-key");
  });

  it("tanpa providerOverrides, perilaku node-level tidak berubah", async () => {
    await runExecute(credsWith([{ name: "X-Node", value: "n" }]), null);
    expect(capturedHeaders["X-Node"]).toBe("n");
    await runExecute(credsWith([]), undefined);
    expect(capturedHeaders["X-Node"]).toBeUndefined();
  });
});
