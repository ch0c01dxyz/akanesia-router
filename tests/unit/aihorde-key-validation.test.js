/**
 * Unit tests for AI Horde API key validation (src/lib/validateAihordeKey.js),
 * used by POST /api/providers/validate for provider "aihorde".
 *
 * Covers:
 *  - 200 + user info  -> valid
 *  - 401 / 403        -> invalid, pesan Bahasa Indonesia
 *  - network error    -> "unknown" (fail-open: BUKAN invalid)
 *  - 5xx / 200 tanpa user info -> "unknown"
 *  - API key dikirim di header `apikey`
 */

import { describe, it, expect, vi } from "vitest";
import { validateAihordeKey } from "@/lib/validateAihordeKey.js";

const URL = "https://aihorde.net/api/v2/find_user";

function mockFetch({ status = 200, json = null, reject = null } = {}) {
  if (reject) return vi.fn().mockRejectedValue(reject);
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(json),
  });
}

describe("validateAihordeKey", () => {
  it("200 + info user -> valid, key dikirim di header apikey", async () => {
    const fetchFn = mockFetch({ status: 200, json: { id: 1234, username: "egar" } });
    const r = await validateAihordeKey("key-asli", fetchFn);
    expect(r).toEqual({ valid: true, error: null });
    expect(fetchFn).toHaveBeenCalledWith(
      URL,
      expect.objectContaining({ headers: { apikey: "key-asli" } })
    );
  });

  it("401 -> invalid dengan pesan Bahasa Indonesia", async () => {
    const r = await validateAihordeKey("key-salah", mockFetch({ status: 401 }));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/tidak valid|kedaluwarsa/);
    expect(r.status).toBeUndefined();
  });

  it("403 -> invalid", async () => {
    const r = await validateAihordeKey("key-salah", mockFetch({ status: 403 }));
    expect(r.valid).toBe(false);
    expect(r.status).toBeUndefined();
  });

  it("network error -> unknown (fail-open, bukan invalid)", async () => {
    const r = await validateAihordeKey(
      "key-bagus",
      mockFetch({ reject: new Error("fetch failed") })
    );
    expect(r.valid).toBe(false);
    expect(r.status).toBe("unknown");
    expect(r.error).toMatch(/Tidak dapat memverifikasi/);
  });

  it("HTTP 500 -> unknown, bukan invalid", async () => {
    const r = await validateAihordeKey("key-bagus", mockFetch({ status: 500 }));
    expect(r.valid).toBe(false);
    expect(r.status).toBe("unknown");
    expect(r.error).toMatch(/Tidak dapat memverifikasi/);
  });

  it("200 tanpa info user -> unknown (fail-open)", async () => {
    const r = await validateAihordeKey("key-bagus", mockFetch({ status: 200, json: {} }));
    expect(r.valid).toBe(false);
    expect(r.status).toBe("unknown");
  });
});
