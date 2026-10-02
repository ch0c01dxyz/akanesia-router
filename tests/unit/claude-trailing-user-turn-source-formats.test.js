// Sumber non-messages[] (Gemini contents[], Responses input[]) membawa role
// terminal klien dalam bentuknya sendiri. Giliran model/assistant eksplisit di
// akhir adalah prefill asli dan harus selamat saat translasi ke Claude; giliran
// user terakhir yang dikosongkan tetap harus mendapat restorasi "Continue.".
import { describe, it, expect } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";

const roles = (body) => body.messages.map((m) => m.role);

describe("giliran user terakhir: format sumber non-messages[]", () => {
  it("mempertahankan giliran model terakhir Gemini (prefill asli)", () => {
    const out = translateRequest("gemini", "claude", "claude-sonnet-4-5", {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "The answer is" }] },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant"]);
  });

  it("mempertahankan pesan assistant terakhir Responses (prefill asli)", () => {
    const out = translateRequest("openai-responses", "claude", "claude-sonnet-4-5", {
      model: "claude-sonnet-4-5",
      input: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "The answer is" },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant"]);
  });

  it("tetap merestorasi giliran user saat giliran user terakhir Gemini dikosongkan", () => {
    const out = translateRequest("gemini", "claude", "claude-sonnet-4-5", {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "hello" }] },
        { role: "user", parts: [] },
      ],
    }, false);
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
  });
});
