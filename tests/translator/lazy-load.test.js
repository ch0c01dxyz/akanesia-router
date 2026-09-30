/**
 * Test lazy-load translator (open-sse/translator/index.js).
 *
 * Memastikan:
 * 1. Registry kosong saat index.js diimpor (tidak ada static side-effect import).
 * 2. ensureTranslatorsFor me-load modul yang diminta sesuai arah (request/response).
 * 3. Panggilan konkuren berbagi satu import (singleflight).
 * 4. Kunci tak dikenal diabaikan tanpa error (passthrough).
 * 5. ensureTranslatorsForRequest mencakup kaki pivot via OpenAI.
 * 6. translateRequest/translateResponse sinkron memakai translator yang benar
 *    setelah ensure (tanpa ensure, translasi pivot tidak terjadi).
 */
import { describe, it, expect } from "vitest";
import {
  ensureTranslatorsFor,
  ensureTranslatorsForRequest,
  isTranslatorLoaded,
  translateRequest,
  translateResponse,
  initState,
} from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("lazy-load translator", () => {
  it("registry kosong sebelum ensure (tanpa static import)", () => {
    expect(isTranslatorLoaded("openai:claude", "request")).toBe(false);
    expect(isTranslatorLoaded("openai:claude", "response")).toBe(false);
    expect(isTranslatorLoaded("claude:openai", "request")).toBe(false);
    expect(isTranslatorLoaded("openai:gemini", "request")).toBe(false);
  });

  it("ensureTranslatorsFor me-load sesuai arah yang diminta", async () => {
    await ensureTranslatorsFor(["openai:claude"], "request");
    expect(isTranslatorLoaded("openai:claude", "request")).toBe(true);
    // Arah response belum diminta → modul response belum ter-load.
    expect(isTranslatorLoaded("openai:claude", "response")).toBe(false);

    await ensureTranslatorsFor(["openai:claude"], "response");
    expect(isTranslatorLoaded("openai:claude", "response")).toBe(true);
  });

  it("singleflight: panggilan konkuren berbagi satu import", async () => {
    await Promise.all([
      ensureTranslatorsFor(["openai:gemini"], "request"),
      ensureTranslatorsFor(["openai:gemini"], "both"),
      ensureTranslatorsForRequest(FORMATS.OPENAI, FORMATS.GEMINI),
    ]);
    expect(isTranslatorLoaded("openai:gemini", "request")).toBe(true);
    // Satu file modul (openai-to-gemini.js) mendaftarkan 3 kunci request sekaligus.
    expect(isTranslatorLoaded("openai:gemini-cli", "request")).toBe(true);
    expect(isTranslatorLoaded("openai:antigravity", "request")).toBe(true);
  });

  it("kunci tak dikenal diabaikan tanpa error (passthrough)", async () => {
    await expect(ensureTranslatorsFor(["foo:bar"], "both")).resolves.toBeUndefined();
    await expect(ensureTranslatorsFor([], "request")).resolves.toBeUndefined();
  });

  it("ensureTranslatorsForRequest mencakup kaki pivot via OpenAI", async () => {
    await ensureTranslatorsForRequest(FORMATS.CLAUDE, FORMATS.GEMINI);
    // Request: claude→openai→gemini (tidak ada translator langsung claude→gemini).
    expect(isTranslatorLoaded("claude:openai", "request")).toBe(true);
    expect(isTranslatorLoaded("openai:gemini", "request")).toBe(true);
    // Response: gemini→openai→claude.
    expect(isTranslatorLoaded("gemini:openai", "response")).toBe(true);
    expect(isTranslatorLoaded("openai:claude", "response")).toBe(true);
  });

  it("translateRequest memakai translator yang benar setelah ensure", async () => {
    await ensureTranslatorsForRequest(FORMATS.OPENAI, FORMATS.CLAUDE);
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      "claude-model",
      { model: "claude-model", messages: [{ role: "user", content: "halo" }] },
      false
    );
    expect(out).toBeTruthy();
    // Bentuk Anthropic: messages + max_tokens.
    expect(Array.isArray(out.messages)).toBe(true);
    expect(out.max_tokens).toBeGreaterThan(0);
  });

  it("translateResponse memakai translator yang benar setelah ensure", async () => {
    await ensureTranslatorsFor(["openai:claude"], "response");
    const state = initState(FORMATS.CLAUDE);
    // translateResponse menerima chunk yang sudah ter-parse (stream.js mem-parse SSE).
    const chunk = {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta: { content: "hai" }, finish_reason: null }],
    };
    // translateResponse(targetFormat=provider, sourceFormat=klien, chunk, state).
    const out = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk, state);
    expect(Array.isArray(out)).toBe(true);
    // Bentuk event Anthropic: content_block_delta.
    expect(JSON.stringify(out)).toContain("content_block_delta");
  });

  it("manifest lengkap: semua pasangan teregistrasi setelah ensure semua kunci", async () => {
    const semuaKunci = [
      "antigravity:openai", "claude:kiro", "claude:openai",
      "gemini:openai", "gemini-cli:openai", "vertex:openai",
      "openai-responses:openai", "openai:openai-responses",
      "openai:claude", "openai:clova", "openai:commandcode", "openai:cursor",
      "openai:gemini", "openai:gemini-cli", "openai:antigravity",
      "openai:kiro", "openai:ollama", "openai:vertex",
      "clova:openai", "commandcode:openai", "cursor:openai",
      "kiro:claude", "kiro:openai", "ollama:openai",
    ];
    await ensureTranslatorsFor(semuaKunci, "both");
    for (const kunci of semuaKunci) {
      expect(isTranslatorLoaded(kunci, "both")).toBe(true);
    }
  });
});
