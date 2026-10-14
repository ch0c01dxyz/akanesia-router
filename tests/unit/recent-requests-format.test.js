import { describe, it, expect } from "vitest";
import {
  formatRelativeTime,
  requestStatusClass,
  requestStatusLabel,
  providerLabel,
} from "@/app/(dashboard)/dashboard/endpoint/components/recentRequestsFormat.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const ago = (ms) => new Date(Date.now() - ms).toISOString();

describe("formatRelativeTime", () => {
  it("mengembalikan 'baru saja' untuk timestamp < 5 detik", () => {
    expect(formatRelativeTime(ago(2000))).toBe("baru saja");
  });
  it("mengembalikan detik untuk < 60 detik", () => {
    expect(formatRelativeTime(ago(45000))).toBe("45 dtk lalu");
  });
  it("mengembalikan menit untuk < 60 menit", () => {
    expect(formatRelativeTime(ago(3 * 60 * 1000))).toBe("3 mnt lalu");
  });
  it("mengembalikan jam untuk < 24 jam", () => {
    expect(formatRelativeTime(ago(2 * 60 * 60 * 1000))).toBe("2 jam lalu");
  });
  it("mengembalikan hari untuk >= 24 jam", () => {
    expect(formatRelativeTime(ago(5 * 24 * 60 * 60 * 1000))).toBe("5 hari lalu");
  });
  it("mengembalikan '—' untuk timestamp invalid", () => {
    expect(formatRelativeTime("bukan-tanggal")).toBe("—");
    expect(formatRelativeTime(undefined)).toBe("—");
  });
});

describe("requestStatusClass", () => {
  it("success → hijau, error → merah, lainnya → abu-abu", () => {
    expect(requestStatusClass("success")).toBe("bg-green-500");
    expect(requestStatusClass("error")).toBe("bg-red-500");
    expect(requestStatusClass("pending")).toBe("bg-gray-500");
    expect(requestStatusClass(undefined)).toBe("bg-gray-500");
  });
});

describe("requestStatusLabel", () => {
  it("label Bahasa Indonesia", () => {
    expect(requestStatusLabel("success")).toBe("Sukses");
    expect(requestStatusLabel("error")).toBe("Gagal");
  });
});

describe("providerLabel", () => {
  it("nama koneksi menang atas AI_PROVIDERS dan id mentah", () => {
    expect(providerLabel("openai", { openai: "Kunci Kantor" })).toBe("Kunci Kantor");
  });
  it("fallback ke nama AI_PROVIDERS bila tidak ada nama koneksi", () => {
    const id = Object.keys(AI_PROVIDERS).find((k) => AI_PROVIDERS[k]?.name);
    expect(providerLabel(id, {})).toBe(AI_PROVIDERS[id].name);
  });
  it("fallback ke id mentah untuk provider tak dikenal", () => {
    expect(providerLabel("openai-compatible-chat-abc123", {})).toBe("openai-compatible-chat-abc123");
  });
});
