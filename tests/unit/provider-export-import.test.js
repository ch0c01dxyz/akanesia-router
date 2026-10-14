/**
 * Test validasi logika import/export koneksi provider.
 * Menguji fungsi validasi tanpa DB (pure logic).
 */
import { describe, it, expect } from "vitest";

// Duplikat dari route.js untuk testing (hindari import Next.js)
const KNOWN_AUTH_TYPES = new Set(["apikey", "oauth", "cookie", "none"]);

function sanitizeStr(v, max = 500) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function validateConnection(c) {
  if (!c || typeof c !== "object") return "Connection harus objek";
  const authType = sanitizeStr(c.authType, 50);
  if (!authType || !KNOWN_AUTH_TYPES.has(authType)) {
    return `authType tidak dikenal: ${String(c.authType).slice(0, 50)}`;
  }
  if (authType === "apikey" && !sanitizeStr(c.apiKey, 2000)) {
    return "apikey membutuhkan apiKey yang tidak kosong";
  }
  if (authType === "oauth" && !sanitizeStr(c.email, 320) && !sanitizeStr(c.accessToken, 4000)) {
    return "oauth membutuhkan email atau accessToken";
  }
  return null;
}

function detectDuplicates(connections, existing = []) {
  const existingKeys = new Set(
    existing.filter((c) => c.authType === "apikey" && c.apiKey).map((c) => `key:${c.apiKey}`)
  );
  const existingEmails = new Set(
    existing.filter((c) => c.authType === "oauth" && c.email).map((c) => `email:${c.email.toLowerCase()}`)
  );
  const skipped = [];
  const toImport = [];
  for (let i = 0; i < connections.length; i++) {
    const c = connections[i];
    const key = c.authType === "apikey" && c.apiKey ? `key:${c.apiKey}` : null;
    const email = c.authType === "oauth" && c.email ? `email:${c.email.toLowerCase()}` : null;
    if ((key && existingKeys.has(key)) || (email && existingEmails.has(email))) {
      skipped.push(i);
    } else {
      toImport.push(i);
      if (key) existingKeys.add(key);
      if (email) existingEmails.add(email);
    }
  }
  return { skipped, toImport };
}

describe("import/export validation", () => {
  it("validasi: koneksi apikey valid lolos", () => {
    expect(validateConnection({ authType: "apikey", apiKey: "sk-123", name: "Test" })).toBeNull();
  });

  it("validasi: koneksi oauth dengan email lolos", () => {
    expect(validateConnection({ authType: "oauth", email: "a@b.com" })).toBeNull();
  });

  it("validasi: authType tidak dikenal ditolak", () => {
    expect(validateConnection({ authType: "magic", apiKey: "x" })).toMatch(/tidak dikenal/);
  });

  it("validasi: apikey tanpa apiKey ditolak", () => {
    expect(validateConnection({ authType: "apikey", name: "X" })).toMatch(/membutuhkan apiKey/);
  });

  it("validasi: oauth tanpa email/token ditolak", () => {
    expect(validateConnection({ authType: "oauth" })).toMatch(/membutuhkan email/);
  });

  it("validasi: bukan objek ditolak", () => {
    expect(validateConnection(null)).toMatch(/harus objek/);
    expect(validateConnection("x")).toMatch(/harus objek/);
  });

  it("duplikat: apiKey sama di-skip", () => {
    const existing = [{ authType: "apikey", apiKey: "sk-abc" }];
    const incoming = [
      { authType: "apikey", apiKey: "sk-abc", name: "Dup" },
      { authType: "apikey", apiKey: "sk-new", name: "New" },
    ];
    const { skipped, toImport } = detectDuplicates(incoming, existing);
    expect(skipped).toEqual([0]);
    expect(toImport).toEqual([1]);
  });

  it("duplikat: email oauth sama (case-insensitive) di-skip", () => {
    const existing = [{ authType: "oauth", email: "A@B.com" }];
    const incoming = [{ authType: "oauth", email: "a@b.COM", name: "Dup" }];
    const { skipped } = detectDuplicates(incoming, existing);
    expect(skipped).toEqual([0]);
  });

  it("duplikat: dalam file yang sama terdeteksi", () => {
    const incoming = [
      { authType: "apikey", apiKey: "sk-x", name: "A" },
      { authType: "apikey", apiKey: "sk-x", name: "B" },
    ];
    const { skipped, toImport } = detectDuplicates(incoming, []);
    expect(skipped).toEqual([1]);
    expect(toImport).toEqual([0]);
  });

  it("sanitasi: string kosong jadi null", () => {
    expect(sanitizeStr("", 100)).toBeNull();
    expect(sanitizeStr("   ", 100)).toBeNull();
    expect(sanitizeStr(null, 100)).toBeNull();
  });

  it("sanitasi: dipotong sesuai max", () => {
    expect(sanitizeStr("abcdef", 3)).toBe("abc");
  });
});
