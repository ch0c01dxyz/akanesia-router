// Ide #8 — custom headers per provider node (Advanced Option).
// Lock-in: DefaultExecutor.buildHeaders menerapkan customHeaders PALING AKHIR
// (menang atas header default), resolve {{key}} -> API key koneksi, dan
// redaksi log tidak membocorkan value-nya.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sanitizeCustomHeaders,
  applyCustomHeaders,
  redactCustomHeaders,
  getCustomHeaderNames,
} from "@/shared/utils/customHeaders.js";

let DefaultExecutor;

beforeEach(async () => {
  vi.resetModules();
  ({ DefaultExecutor } = await import("open-sse/executors/default.js"));
});

const credsWith = (customHeaders) => ({
  apiKey: "sk-conn-KEY",
  provider: "openai-compatible-chat",
  providerSpecificData: {
    baseUrl: "https://example.com/v1",
    apiType: "chat",
    customHeaders,
  },
});

describe("sanitizeCustomHeaders", () => {
  it("melewatkan baris kosong dan menerima header valid", () => {
    const { headers, error } = sanitizeCustomHeaders([
      { name: "x-api-key", value: "{{key}}" },
      { name: "", value: "" },
    ]);
    expect(error).toBeUndefined();
    expect(headers).toEqual([{ name: "x-api-key", value: "{{key}}" }]);
  });

  it("menolak nama header tidak valid", () => {
    expect(sanitizeCustomHeaders([{ name: "bad name", value: "x" }]).error).toBeTruthy();
    expect(sanitizeCustomHeaders([{ name: "a:b", value: "x" }]).error).toBeTruthy();
  });

  it("menolak duplikat case-insensitive", () => {
    const { error } = sanitizeCustomHeaders([
      { name: "X-Api-Key", value: "1" },
      { name: "x-api-key", value: "2" },
    ]);
    expect(error).toBeTruthy();
  });
});

describe("DefaultExecutor.buildHeaders custom headers", () => {
  it("custom header menang atas header default dan {{key}} ter-resolve", () => {
    const executor = new DefaultExecutor("openai-compatible-chat");
    const h = executor.buildHeaders(
      credsWith([
        { name: "x-api-key", value: "{{key}}" },
        { name: "Authorization", value: "Bearer OVERRIDE" },
      ]),
      true
    );
    expect(h["x-api-key"]).toBe("sk-conn-KEY");
    expect(h["Authorization"]).toBe("Bearer OVERRIDE");
    expect(h["Content-Type"]).toBe("application/json"); // default lain tetap ada
  });

  it("tanpa customHeaders perilaku tidak berubah", () => {
    const executor = new DefaultExecutor("openai-compatible-chat");
    const h = executor.buildHeaders(credsWith(undefined), true);
    expect(h["Authorization"]).toBe("Bearer sk-conn-KEY");
    expect(h["x-api-key"]).toBeUndefined();
  });
});

describe("redactCustomHeaders", () => {
  it("me-redact value custom header tanpa mengubah objek asli", () => {
    const creds = credsWith([{ name: "x-api-key", value: "{{key}}" }]);
    const original = { "x-api-key": "sk-conn-KEY", "Content-Type": "application/json" };
    const redacted = redactCustomHeaders(original, creds);
    expect(redacted["x-api-key"]).toBe("[REDACTED]");
    expect(redacted["Content-Type"]).toBe("application/json");
    expect(original["x-api-key"]).toBe("sk-conn-KEY");
    expect(getCustomHeaderNames(creds)).toEqual(["x-api-key"]);
  });
});
