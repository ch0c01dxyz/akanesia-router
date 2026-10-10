import { describe, expect, it } from "vitest";

import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// #4409: 400 code 1210 "Invalid API parameter" intermiten pada GLM-5.3-Flash via
// https://api.z.ai/api/anthropic/v1/messages, mulai v0.5.91.
//
// Dok z.ai eksplisit: "GLM-5.3 dan GLM-5.3-FLASH tidak lagi mendukung
// penonaktifan thinking (error bila parameter thinking.type di-set disabled.
// Pastikan thinking tetap enabled)."
//
// capabilities.js mengiklankan thinkingCanDisable:true untuk lini itu, sehingga
// applyThinking memancarkan enable_thinking:false pada setiap turn yang meminta
// tanpa reasoning — dan inilah sebabnya INTERMITEN: hanya sebagian turn yang meminta.

const models = ["glm-5.3-flash", "glm-5.3"];

describe("GLM 5.3 tidak boleh dikirimi thinking=disabled (#4409)", () => {
  it.each(models)(
    "%s ditandai tidak bisa menonaktifkan thinking",
    (id) => {
      expect(getCapabilitiesForModel("glm", id).thinkingCanDisable).toBe(false);
    }
  );

  it.each([
    ["reasoning_effort: none", { reasoning_effort: "none" }],
    ["reasoning_effort: off", { reasoning_effort: "off" }],
    ["thinking.type: disabled", { thinking: { type: "disabled" } }],
  ])(
    "%s membuat thinking tetap aktif, bukan menonaktifkannya",
    (_label, seed) => {
      for (const id of models) {
        const body = structuredClone(seed);
        applyThinking("claude", id, body, "glm");
        // Kegagalan yang dilaporkan z.ai: enable_thinking:false / thinking disabled.
        expect(body.enable_thinking, id).toBeUndefined();
        expect(body.thinking?.type, id).not.toBe("disabled");
      }
    }
  );

  it.each(models)(
    "%s membiarkan thinking milik request normal tetap utuh",
    (id) => {
      // Tanpa sinyal disable, applyThinking tidak menyuntikkan apa pun — blok
      // thinking milik klien lewat apa adanya. Yang penting: tidak ada yang mematikannya.
      const body = { thinking: { type: "enabled" } };
      applyThinking("claude", id, body, "glm");
      expect(body.enable_thinking, id).toBeUndefined();
      expect(body.thinking?.type, id).not.toBe("disabled");
    }
  );

  it("tidak meregresi model yang BISA menonaktifkan thinking", () => {
    // 5.1 dan yang lebih tua tetap menerima thinking.type=disabled, dan fix ini
    // tidak boleh mengubahnya. (glm-5.2 sengaja TIDAK di-assert di sini: entry
    // MODEL_CAPABILITIES eksak yang pre-existing men-set canDisable:false untuknya,
    // terpisah dari #4409.)
    for (const id of ["glm-5.1", "glm-5-turbo", "glm-5"]) {
      expect(getCapabilitiesForModel("glm", id).thinkingCanDisable, id).toBe(true);
      const b = { reasoning_effort: "none" };
      applyThinking("claude", id, b, "glm");
      expect(b.enable_thinking, id).toBe(false);
    }
  });
});
