/**
 * Test untuk #4410 — registry Kiro kekurangan model claude-opus-5.5.
 *
 * Kiro menambahkan Claude Opus 5.5 sebagai experimental preview pada 2026-09-22.
 * Model tidak ada di open-sse/providers/registry/kiro.js.
 *
 * Perbaikan (ADAPTASI lokal): HANYA tambah 4 entri registry. Entri capabilities
 * eksak TIDAK ditambahkan karena pola lokal `*claude*opus-5*` sudah meng-cover
 * opus-5.5 (vision, reasoning, search, adaptive thinking, context 1M) —
 * terverifikasi runtime. Test capabilities di bawah mengunci coverage pola itu.
 */

import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import fs from "fs";

const kiroSrc = fs.readFileSync(
  new URL("../../open-sse/providers/registry/kiro.js", import.meta.url),
  "utf-8"
);

describe("Registry Kiro — claude-opus-5.5 (#4410)", () => {
  it("memuat claude-opus-5.5 di registry kiro", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5"');
  });

  it("memuat claude-opus-5.5-thinking di registry kiro", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5-thinking"');
  });

  it("memuat claude-opus-5.5-agentic di registry kiro", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5-agentic"');
  });

  it("memuat claude-opus-5.5-thinking-agentic di registry kiro", () => {
    expect(kiroSrc).toContain('"claude-opus-5.5-thinking-agentic"');
  });

  it("claude-opus-5 tetap ada (regression guard)", () => {
    expect(kiroSrc).toContain('"claude-opus-5"');
  });
});

describe("Capabilities — claude-opus-5.5 via pola *claude*opus-5* (#4410)", () => {
  it("claude-opus-5.5 punya vision:true", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.vision).toBe(true);
  });

  it("claude-opus-5.5 punya reasoning:true", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.reasoning).toBe(true);
  });

  it("claude-opus-5.5 punya contextWindow 1M", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.contextWindow).toBe(1000000);
  });

  it("claude-opus-5.5 punya maxOutput 128000", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5");
    expect(caps.maxOutput).toBe(128000);
  });

  it("claude-opus-5.5-thinking punya capabilities yang sama", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5.5-thinking");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
  });

  it("claude-opus-5 tetap punya context 1M (regression guard)", () => {
    const caps = getCapabilitiesForModel("kiro", "claude-opus-5");
    expect(caps.contextWindow).toBe(1000000);
  });
});
