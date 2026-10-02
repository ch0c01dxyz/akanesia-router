import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// claude-sonnet-5-5 tanpa entri exact dulu hanya cocok dengan pola generik
// *claude*sonnet* (claude-budget). Itu mengirim thinking.type "enabled" dan
// membuat translator memalsukan placeholder thinking bertanda tangan di setiap
// giliran tool_use; Sonnet 5.5 menjawab percakapan Codex besar dengan
// stop_reason "refusal". Ia harus resolve seperti keluarga 5.x lainnya:
// adaptive thinking, konteks 1M.
describe("Kapabilitas Claude Sonnet 5.5", () => {
  for (const model of ["claude-sonnet-5-5", "claude-sonnet-5.5", "anthropic/claude-sonnet-5-5"]) {
    it(`${model} resolve ke adaptive thinking + konteks 1M`, () => {
      expect(getCapabilitiesForModel("claude", model)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        contextWindow: 1000000,
        maxOutput: 128000,
        reasoning: true,
      });
    });
  }
});
