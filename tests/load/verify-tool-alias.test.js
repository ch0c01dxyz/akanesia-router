/**
 * VERIFIKASI post-fix fitur 1: aliasing parameter tool.
 * Mengimpor fungsi asli via re-implementasi 1:1 (fungsi tidak di-export).
 * Untuk verifikasi integrasi penuh, logika disalin persis dari source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Ambil source asli dan eval fungsi sanitize (isolated)
const src = readFileSync(
  new URL("../../open-sse/translator/response/openai-to-claude.js", import.meta.url),
  "utf8"
);

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`fn ${name} tidak ditemukan`);
  let depth = 0, i = src.indexOf("{", start);
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// Bangun modul uji dari fungsi asli
const testModule = `
${extractFn("applyAlias")}
${extractFn("sanitizeReadArgs")}
${extractFn("sanitizeBashArgs")}
${extractFn("sanitizeEditArgs")}
${extractFn("sanitizeWriteArgs")}
${extractFn("isValidPdfPagesArg")}
`;
const fns = new Function(`${testModule}; return { applyAlias, sanitizeReadArgs, sanitizeBashArgs, sanitizeEditArgs, sanitizeWriteArgs };`)();

describe("VERIFIKASI post-fix: tool param aliasing", () => {
  it("Read: path → file_path", () => {
    const args = { path: "/tmp/x" };
    fns.sanitizeReadArgs(args);
    expect(args.file_path).toBe("/tmp/x");
  });

  it("Read: filePath → file_path", () => {
    const args = { filePath: "/tmp/x" };
    fns.sanitizeReadArgs(args);
    expect(args.file_path).toBe("/tmp/x");
  });

  it("Read: file_path eksisting tidak ditimpa", () => {
    const args = { file_path: "/real", path: "/fake" };
    fns.sanitizeReadArgs(args);
    expect(args.file_path).toBe("/real");
  });

  it("Bash: cmd → command", () => {
    const args = { cmd: "ls" };
    fns.sanitizeBashArgs(args);
    expect(args.command).toBe("ls");
  });

  it("Bash: input → command", () => {
    const args = { input: "pwd" };
    fns.sanitizeBashArgs(args);
    expect(args.command).toBe("pwd");
  });

  it("Edit: filePath+oldText+newText ternormalisasi", () => {
    const args = { filePath: "/a", oldText: "x", newText: "y" };
    fns.sanitizeEditArgs(args);
    expect(args.file_path).toBe("/a");
    expect(args.old_string).toBe("x");
    expect(args.new_string).toBe("y");
  });

  it("Write: path+content → file_path (content tetap)", () => {
    const args = { path: "/a", content: "hi" };
    fns.sanitizeWriteArgs(args);
    expect(args.file_path).toBe("/a");
    expect(args.content).toBe("hi");
  });

  it("Write: text → content", () => {
    const args = { path: "/a", text: "hi" };
    fns.sanitizeWriteArgs(args);
    expect(args.content).toBe("hi");
  });

  it("Read: limit string tetap di-coerce (regresi)", () => {
    const args = { file_path: "/a", limit: "10" };
    fns.sanitizeReadArgs(args);
    expect(args.limit).toBe(10);
  });
});
