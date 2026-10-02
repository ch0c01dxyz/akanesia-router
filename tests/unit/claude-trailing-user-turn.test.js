// Anthropic menolak body yang diakhiri giliran assistant ("This model does not
// support assistant message prefill"). Pass cleanup menghapus pesan yang
// dikosongkan, sehingga giliran user terakhir yang dikosongkan dulu
// meninggalkan giliran assistant sebelumnya sebagai yang terakhir.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";

const roles = (body) => body.messages.map((m) => m.role);
const history = (last) => [
  { role: "user", content: "hi" },
  { role: "assistant", content: [{ type: "text", text: "hello" }] },
  last,
];

const emptyLastTurns = {
  "string kosong": { role: "user", content: "" },
  "block teks blank": { role: "user", content: [{ type: "text", text: "  " }] },
  "array content kosong": { role: "user", content: [] },
  "hanya block tak didukung": { role: "user", content: [{ type: "search_result", source: "x", title: "t", content: [] }] },
};

describe("giliran user terakhir selamat dari cleanup pesan kosong", () => {
  for (const [name, last] of Object.entries(emptyLastTurns)) {
    it(`prepareClaudeRequest: ${name}`, () => {
      const out = prepareClaudeRequest({ model: "claude-opus-4-5", max_tokens: 100, messages: history(last) }, "claude");
      expect(roles(out)).toEqual(["user", "assistant", "user"]);
    });
    it(`normalizeClaudePassthrough: ${name}`, () => {
      const out = normalizeClaudePassthrough({ model: "claude-opus-4-5", messages: history(last) }, "claude-opus-4-5");
      expect(roles(out)).toEqual(["user", "assistant", "user"]);
    });
  }

  it("passthrough: tool_result dari server_tool_use asing yang dibuang tidak lagi mengosongkan giliran terakhir jadi prefill", () => {
    const out = normalizeClaudePassthrough({
      model: "claude-opus-4-5",
      messages: [
        { role: "user", content: "analyze" },
        { role: "assistant", content: [{ type: "server_tool_use", id: "call_abc", name: "analyze_image", input: {} }, { type: "text", text: "done" }] },
        { role: "user", content: [{ type: "web_search_tool_result", tool_use_id: "call_abc", content: [] }] },
      ],
    }, "claude-opus-4-5");
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
  });

  it("pipeline penuh: klien OpenAI dengan pesan user terakhir kosong", () => {
    const out = translateRequest("openai", "claude", "claude-opus-4-5", {
      model: "x", max_tokens: 100,
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "" }],
    }, true, null, "claude");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("pipeline penuh: klien Claude dengan block user terakhir blank", () => {
    const out = translateRequest("claude", "claude", "claude-opus-4-5", {
      model: "x", max_tokens: 100, messages: history({ role: "user", content: [{ type: "text", text: "" }] }),
    }, true, null, "claude");
    expect(out.messages.at(-1).role).toBe("user");
  });

  it("prefill sengaja dari klien (giliran terakhir assistant) tidak disentuh", () => {
    const body = { model: "claude-opus-4-5", max_tokens: 100, messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "text", text: "Sure:" }] },
    ] };
    expect(roles(prepareClaudeRequest(structuredClone(body), "claude"))).toEqual(["user", "assistant"]);
    expect(roles(normalizeClaudePassthrough(structuredClone(body), "claude-opus-4-5"))).toEqual(["user", "assistant"]);
  });

  it("tidak menambah apapun bila giliran user terakhir berisi konten", () => {
    const out = prepareClaudeRequest({ model: "claude-opus-4-5", max_tokens: 100, messages: history({ role: "user", content: "next" }) }, "claude");
    expect(roles(out)).toEqual(["user", "assistant", "user"]);
    expect(out.messages.at(-1).content[0].text).toBe("next");
  });
});
