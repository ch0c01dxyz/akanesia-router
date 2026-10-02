/**
 * Test untuk sinkronisasi URL ?provider= dengan filter provider (deep link
 * yang bisa di-bookmark).
 *
 * Sebelum perbaikan, membuka /dashboard/quota?provider=codex mengabaikan
 * parameter query dan selalu default ke "All providers". Pilihan dropdown
 * hanya mengubah state lokal tanpa memperbarui URL.
 *
 * Perbaikan: ProviderLimits menginisialisasi providerFilter dari
 * useSearchParams dan membungkus setProviderFilter agar memanggil
 * router.replace saat filter berubah.
 *
 * Karena ProviderLimits adalah file JSX, ia tidak bisa di-import di Vitest
 * tanpa setup Next.js penuh. Kami memverifikasi teks sumber sebagai gantinya.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js"
  ),
  "utf-8"
);

describe("ProviderLimits — sinkronisasi URL ?provider=", () => {
  it("mengimpor useSearchParams dari next/navigation", () => {
    expect(src).toContain("useSearchParams");
    expect(src).toContain("next/navigation");
  });

  it("mengimpor useRouter dari next/navigation", () => {
    expect(src).toContain("useRouter");
  });

  it("mengimpor usePathname dari next/navigation", () => {
    expect(src).toContain("usePathname");
  });

  it("menginisialisasi providerFilter dari searchParams.get('provider')", () => {
    expect(src).toMatch(/searchParams.*get.*provider/);
  });

  it("memanggil router.replace saat filter provider berubah", () => {
    expect(src).toContain("router.replace");
  });

  it("menghapus ?provider dari URL saat 'all' dipilih", () => {
    expect(src).toContain("params.delete");
  });

  it("mengatur ?provider di URL saat provider spesifik dipilih", () => {
    expect(src).toContain('params.set("provider"');
  });
});
