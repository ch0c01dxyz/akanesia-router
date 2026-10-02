/**
 * Regression test untuk #4232
 *
 * codebuddy-intl belum ada di OAUTH_TEST_CONFIG. Handler test route
 * mengembalikan {"valid":false,"error":"Provider test not supported"} untuk
 * setiap akun codebuddy-intl, apa pun validitas tokennya.
 *
 * Fix: tambah "codebuddy-intl": { tokenExists: true } berdampingan dengan
 * "codebuddy-cn". Kedua provider memakai struktur token JWT yang sama (eyJ…,
 * expiry ~1 tahun, pasangan access + refresh token) sehingga strategi test
 * yang sama berlaku.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Baca file sumber dan verifikasi entri config ada di teksnya.
// testUtils.js adalah file server Next.js sehingga kita inspeksi teks sumber
// alih-alih meng-import-nya (menghindari kebutuhan bootstrap next/server).
// Path berbasis import.meta.url agar robust terhadap CWD saat vitest dijalankan.
const src = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/app/api/providers/[id]/test/testUtils.js"
  ),
  "utf-8"
);

describe("OAUTH_TEST_CONFIG — codebuddy-intl (#4232)", () => {
  it('berisi entri "codebuddy-intl"', () => {
    expect(src).toContain('"codebuddy-intl"');
  });

  it('"codebuddy-intl" memakai tokenExists: true', () => {
    // Cocokkan entri spesifik: "codebuddy-intl": { tokenExists: true }
    expect(src).toMatch(/"codebuddy-intl"\s*:\s*\{\s*tokenExists\s*:\s*true\s*\}/);
  });

  it('"codebuddy-cn" tetap tokenExists: true (regression guard)', () => {
    expect(src).toMatch(/"codebuddy-cn"\s*:\s*\{\s*tokenExists\s*:\s*true\s*\}/);
  });
});
