import { describe, it, expect } from "vitest";
import { maskApiKey } from "@/shared/utils/maskApiKey.js";

describe("maskApiKey", () => {
  it("menyamarkan bagian tengah, awal/akhir tetap", () => {
    const masked = maskApiKey("sk_9router_abcdefghij123456");
    expect(masked.startsWith("sk_9ro")).toBe(true);
    expect(masked.endsWith("3456")).toBe(true);
    expect(masked).not.toContain("abcdefghij");
    expect(masked.length).toBe("sk_9router_abcdefghij123456".length);
  });

  it("key pendek/null tidak diubah secara merusak", () => {
    expect(maskApiKey("short")).toBe("short");
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey(null)).toBe("");
    expect(maskApiKey(undefined)).toBe("");
  });

  it("dua key berbeda menghasilkan mask berbeda", () => {
    expect(maskApiKey("sk_9router_aaaaaaaaaaaaaaaa")).not.toBe(
      maskApiKey("sk_9router_bbbbbbbbbbbbbbbb")
    );
  });
});
