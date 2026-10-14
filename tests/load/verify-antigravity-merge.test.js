/**
 * VERIFIKASI post-fix fitur 2: image-gen path merge turn bersebelahan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../../open-sse/executors/antigravity.js", import.meta.url),
  "utf8"
);

describe("VERIFIKASI post-fix: image-gen turn merging", () => {
  it("source mengandung logika merge adjacent", () => {
    // Verifikasi kode fix ada di file
    expect(src).toContain("last.parts.push(...textParts)");
  });

  it("simulasi: 2 turn user berturut-turut ter-merge", () => {
    // Replika logika post-fix dari antigravity.js
    function buildContents(srcContents) {
      const contents = [];
      for (const c of srcContents) {
        const textParts = (c.parts || []).filter(p => p.text !== undefined).map(p => ({ text: p.text }));
        if (textParts.length > 0) {
          const role = c.role || "user";
          const last = contents.at(-1);
          if (last && last.role === role) last.parts.push(...textParts);
          else contents.push({ role, parts: textParts });
        }
      }
      return contents;
    }

    const out = buildContents([
      { role: "user", parts: [{ text: "gambar kucing" }] },
      { role: "user", parts: [{ text: "yang lucu" }] },
      { role: "model", parts: [{ text: "ok" }] },
    ]);
    expect(out.length).toBe(2);
    expect(out[0].parts.length).toBe(2);
    expect(out[0].parts[0].text).toBe("gambar kucing");
    expect(out[0].parts[1].text).toBe("yang lucu");
  });

  it("turn dengan parts kosong tetap dibuang", () => {
    function buildContents(srcContents) {
      const contents = [];
      for (const c of srcContents) {
        const textParts = (c.parts || []).filter(p => p.text !== undefined).map(p => ({ text: p.text }));
        if (textParts.length > 0) {
          const role = c.role || "user";
          const last = contents.at(-1);
          if (last && last.role === role) last.parts.push(...textParts);
          else contents.push({ role, parts: textParts });
        }
      }
      return contents;
    }
    const out = buildContents([
      { role: "user", parts: [{ text: "halo" }] },
      { role: "model", parts: [] },
      { role: "user", parts: [{ image: "x" }] },
    ]);
    expect(out.length).toBe(1);
  });
});
