// #4316: pesan user yang satu-satunya block adalah `container_upload`
// (Anthropic Files API) dibuang utuh, sehingga provider menerima
// `messages: []` dan request tetap 200 tanpa indikasi user turn hilang.
//
// hasValidContent() mendaftar tipe block yang dihitung sebagai konten, dan
// tipe di luar daftar itu membuat pesan terlihat kosong — lalu
// prepareClaudeRequest memfilternya. container_upload adalah input Anthropic
// yang valid berdiri sendiri, dan pada route Claude→Claude tidak ada
// translasi sama sekali, jadi block harus sampai ke provider utuh.
import { describe, expect, it } from "vitest";

import { hasValidContent, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const uploadBlock = { type: "container_upload", file_id: "file_abc123" };

describe("container_upload menjaga user turn tetap hidup (#4316)", () => {
  it("menghitung satu block container_upload sebagai konten", () => {
    expect(hasValidContent({ role: "user", content: [uploadBlock] })).toBe(true);
  });

  it("menghitung objek container_upload telanjang sebagai konten", () => {
    expect(hasValidContent({ role: "user", content: uploadBlock })).toBe(true);
  });

  it("tidak meneruskan messages: [] untuk request hanya-container_upload", () => {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: [uploadBlock] }],
    };
    const prepared = prepareClaudeRequest(body);
    expect(prepared.messages).toHaveLength(1);
    expect(prepared.messages[0].role).toBe("user");
    expect(prepared.messages[0].content).toContainEqual(expect.objectContaining({
      type: "container_upload",
      file_id: "file_abc123",
    }));
  });

  it("tetap membuang pesan yang benar-benar kosong", () => {
    expect(hasValidContent({ role: "user", content: [] })).toBe(false);
    expect(hasValidContent({ role: "user", content: [{ type: "text", text: "   " }] })).toBe(false);
  });

  it("mempertahankan container_upload berdampingan dengan text", () => {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: [uploadBlock, { type: "text", text: "summarise this" }] }],
    };
    const prepared = prepareClaudeRequest(body);
    expect(prepared.messages).toHaveLength(1);
  });
});
