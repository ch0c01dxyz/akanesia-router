import { describe, it, expect } from "vitest";

import {
  resolveFetchTimeoutMs,
  FETCH_CONNECT_TIMEOUT_MS,
} from "../../open-sse/config/runtimeConfig.js";

describe("resolveFetchTimeoutMs (timeout tier per-connection)", () => {
  it("per-koneksi menang atas tier registry dan global", () => {
    expect(resolveFetchTimeoutMs(5000, 30000)).toBe(5000);
  });

  it("string numerik per-koneksi diterima", () => {
    expect(resolveFetchTimeoutMs("7000", 30000)).toBe(7000);
  });

  it("per-koneksi invalid → fail-open ke tier registry", () => {
    for (const bad of [0, -100, 1.5, NaN, "abc", "", "  ", true, null, undefined, {}, []]) {
      expect(resolveFetchTimeoutMs(bad, 30000)).toBe(30000);
    }
  });

  it("registry invalid + per-koneksi invalid → global FETCH_CONNECT_TIMEOUT_MS", () => {
    expect(resolveFetchTimeoutMs(undefined, undefined)).toBe(FETCH_CONNECT_TIMEOUT_MS);
    expect(resolveFetchTimeoutMs("nope", 0)).toBe(FETCH_CONNECT_TIMEOUT_MS);
    expect(resolveFetchTimeoutMs(null, -5)).toBe(FETCH_CONNECT_TIMEOUT_MS);
  });

  it("tanpa per-koneksi → tier registry dipakai", () => {
    expect(resolveFetchTimeoutMs(undefined, 45000)).toBe(45000);
    expect(resolveFetchTimeoutMs(null, "2500")).toBe(2500);
  });
});
