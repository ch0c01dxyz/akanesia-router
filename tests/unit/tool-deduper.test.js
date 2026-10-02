import { describe, it, expect } from "vitest";
import { dedupeTools } from "../../open-sse/utils/toolDeduper.js";

const BASH = (name = "Bash", desc = "Run a shell command") => ({
  name,
  description: desc,
  input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
});

const FUNC_SHAPE = (name = "Bash") => ({
  type: "function",
  function: { name, description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } } } },
});

const MCP_EXA = { name: "mcp__exa__web_search_exa", description: "search" };

describe("toolDeduper — aturan built-in ekuivalen MCP (perilaku lama)", () => {
  it("klien claude + Exa MCP → membuang built-in WebSearch/WebFetch", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }, { name: "WebFetch", description: "web" }, BASH()],
      { clientTool: "claude" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped.sort()).toEqual(["WebFetch", "WebSearch"]);
  });

  it("klien non-claude → aturan built-in MCP TIDAK jalan (perilaku dipertahankan)", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }],
      { clientTool: "codex" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "WebSearch"]);
    expect(stripped).toEqual([]);
  });

  it("panggilan lama tanpa opts: aturan MCP tetap dorman (dulu memang di-gate claude)", () => {
    // chatCore selalu mengirim opts sekarang, tapi pemanggil lama langsung tetap
    // berperilaku lama: tanpa clientTool, aturan MCP tidak aktif.
    const { tools, stripped } = dedupeTools([MCP_EXA, { name: "WebSearch", description: "web" }]);
    expect(tools).toHaveLength(2);
    expect(stripped).toEqual([]);
  });
});

describe("toolDeduper — dedup nama sama DeepSeek (baru)", () => {
  it("model deepseek + nama tool duplikat → definisi pertama dipertahankan", () => {
    const first = BASH();
    const dup = BASH("Bash", "duplicate description");
    const { tools, stripped } = dedupeTools([first, dup], { model: "deepseek-v4-flash" });
    expect(tools).toEqual([first]); // pertama menang, termasuk description-nya
    expect(stripped).toEqual(["Bash"]);
  });

  it("model deepseek + suffix thinking (max) → tetap dedup (suffix di-strip sebelum match)", () => {
    const { tools, stripped } = dedupeTools([BASH(), BASH("Bash", "dup")], { model: "deepseek-v4-flash(max)" });
    expect(tools).toHaveLength(1);
    expect(stripped).toEqual(["Bash"]);
  });

  it("deepseek + 3 tool bernama sama → pertama dipertahankan, dua duplikat dibuang", () => {
    const { tools, stripped } = dedupeTools([BASH(), BASH("Bash", "d1"), BASH("Bash", "d2")], { model: "deepseek-v4-pro" });
    expect(tools).toHaveLength(1);
    expect(stripped).toEqual(["Bash", "Bash"]);
  });

  it("deepseek + tool bentuk function OpenAI → dedup via function.name", () => {
    const { tools } = dedupeTools([FUNC_SHAPE("Bash"), FUNC_SHAPE("Bash")], { model: "deepseek-v4-flash" });
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("Bash");
  });

  it("model non-DeepSeek + nama tool duplikat → tidak disentuh (GLM/MiniMax/Kimi menerimanya)", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, { model: "glm-5.2" });
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("tanpa model → dedup nama sama TIDAK jalan (default aman)", () => {
    const tools = [BASH(), BASH("Bash", "dup")];
    const { tools: out, stripped } = dedupeTools(tools, {});
    expect(out).toBe(tools);
    expect(stripped).toEqual([]);
  });

  it("deepseek + nama berbeda → tidak ada yang dibuang", () => {
    const { tools, stripped } = dedupeTools([BASH("Bash"), BASH("ReadFile")], { model: "deepseek-v4-flash" });
    expect(tools).toHaveLength(2);
    expect(stripped).toEqual([]);
  });

  it("klien claude + deepseek + trigger MCP → kedua aturan berlaku (gabungan stripped)", () => {
    const { tools, stripped } = dedupeTools(
      [MCP_EXA, { name: "WebSearch", description: "web" }, BASH(), BASH("Bash", "dup")],
      { clientTool: "claude", model: "deepseek-v4-flash" }
    );
    expect(tools.map((t) => t.name)).toEqual(["mcp__exa__web_search_exa", "Bash"]);
    expect(stripped.sort()).toEqual(["Bash", "WebSearch"]);
  });
});
