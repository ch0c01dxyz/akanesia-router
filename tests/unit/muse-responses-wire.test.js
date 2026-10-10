/**
 * Muse Spark (Meta Model API) dilayani oleh Responses API. Model yang hanya
 * mendeklarasikan `supportedFormats: ["openai-responses"]` harus tetap bisa
 * dijangkau klien berformat OpenAI: transport harus mengikuti wire format body
 * yang ditranslasi, kalau tidak body Responses (`input`) di-POST ke URL Chat
 * Completions default dan Meta menolaknya dengan `unknown parameter `input``.
 *
 * Paruh kedua bug yang sama: thinking untuk wire Responses harus nested sebagai
 * reasoning.effort, bukan reasoning_effort top-level bentuk Chat (Meta menolak
 * `unknown parameter `reasoning_effort``).
 *
 * Model repro: muse/muse-spark-1.3-contributor(xhigh)
 */
import { describe, expect, it } from "vitest";

import { getModelTargetFormat, getModelSupportedFormats, getModelUpstreamId, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Mencerminkan pemilihan transport di open-sse/handlers/chatCore.js sehingga
// invarian (wire body === wire endpoint) bisa di-assert tanpa harness handler penuh.
function selectTransport(provider, model, sourceFormat) {
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const modelSupportedFormats = getModelSupportedFormats(alias, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const modelTargetTransport = modelTargetFormat ? resolveTransport(provider, modelTargetFormat) : null;
  const useTransport = (!modelSupportedFormats || modelSupportedFormats.includes(sourceFormat))
    ? runtimeTransport
    : modelTargetTransport;
  const targetFormat = useTransport?.format || modelTargetFormat || null;
  return { targetFormat, useTransport };
}

describe("routing wire Responses Muse", () => {
  it("merute klien OpenAI ke transport Responses, cocok dengan body yang ditranslasi", () => {
    const { targetFormat, useTransport } = selectTransport("muse", "muse-spark-1.3-contributor(xhigh)", FORMATS.OPENAI);
    expect(targetFormat).toBe(FORMATS.OPENAI_RESPONSES);
    expect(useTransport?.format).toBe(FORMATS.OPENAI_RESPONSES);
    expect(useTransport?.baseUrl).toBe("https://api.meta.ai/v1/responses");
  });

  it("mempertahankan upstream id setelah strip hanya suffix thinking", () => {
    expect(getModelTargetFormat("muse", "muse-spark-1.3-contributor(xhigh)")).toBe(FORMATS.OPENAI_RESPONSES);
    expect(getModelSupportedFormats("muse", "muse-spark-1.3-contributor(xhigh)")).toEqual([FORMATS.OPENAI_RESPONSES]);
    expect(getModelUpstreamId("muse", "muse-spark-1.3-contributor(xhigh)")).toBe("muse-spark-1.3-contributor(xhigh)");
  });

  it("membiarkan klien Responses native tetap di transport Responses", () => {
    const { targetFormat, useTransport } = selectTransport("muse", "muse-spark-1.3-contributor(xhigh)", FORMATS.OPENAI_RESPONSES);
    expect(targetFormat).toBe(FORMATS.OPENAI_RESPONSES);
    expect(useTransport?.baseUrl).toBe("https://api.meta.ai/v1/responses");
  });
});

describe("bentuk thinking wire Responses Muse", () => {
  it("menulis reasoning.effort (bukan reasoning_effort top-level) untuk wire Responses", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    applyThinking(FORMATS.OPENAI_RESPONSES, "muse-spark-1.3-contributor(xhigh)", body, "muse", { mode: "level", level: "xhigh" });
    expect(body.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("meng-clamp max ke xhigh untuk wire Responses", () => {
    const body = { input: [] };
    applyThinking(FORMATS.OPENAI_RESPONSES, "muse-spark-1.3", body, "muse", { mode: "level", level: "max" });
    expect(body.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("mempertahankan klien Chat Completions pada wire Chat (reasoning_effort top-level)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    applyThinking(FORMATS.OPENAI, "muse-spark-1.3", body, "muse", { mode: "level", level: "high" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.reasoning).toBeUndefined();
  });
});
