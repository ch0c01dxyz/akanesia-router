import { describe, it, expect } from "vitest";

import {
  classifyQuotaError,
  sanitizeProviderErrorRules,
  MAX_PROVIDER_ERROR_RULES,
  ERROR_CLASSES,
} from "../../open-sse/config/quotaErrorClasses.js";

describe("classifyQuotaError", () => {
  describe("rate_limited", () => {
    it("429 polos → rate_limited", () => {
      expect(classifyQuotaError(429, "Too Many Requests")).toBe(ERROR_CLASSES.RATE_LIMITED);
    });
    it("429 ber-body rate-limit → rate_limited", () => {
      expect(classifyQuotaError(429, "rate_limit_exceeded")).toBe(ERROR_CLASSES.RATE_LIMITED);
      expect(classifyQuotaError(429, "slow_down: reduce request rate")).toBe(ERROR_CLASSES.RATE_LIMITED);
      expect(classifyQuotaError(429, "too many requests, retry later")).toBe(ERROR_CLASSES.RATE_LIMITED);
    });
    it("503/504 → rate_limited", () => {
      expect(classifyQuotaError(503, "Service Unavailable")).toBe(ERROR_CLASSES.RATE_LIMITED);
      expect(classifyQuotaError(504, "Gateway Timeout")).toBe(ERROR_CLASSES.RATE_LIMITED);
    });
    it("status string tetap dikenali", () => {
      expect(classifyQuotaError("429", "x")).toBe(ERROR_CLASSES.RATE_LIMITED);
    });
  });

  describe("overloaded", () => {
    it("529 → overloaded", () => {
      expect(classifyQuotaError(529, "overloaded")).toBe(ERROR_CLASSES.OVERLOADED);
    });
    it("429 yang menyebut overloaded/upstream → overloaded", () => {
      expect(classifyQuotaError(429, "The model is overloaded")).toBe(ERROR_CLASSES.OVERLOADED);
      expect(classifyQuotaError(429, "upstream server overloaded")).toBe(ERROR_CLASSES.OVERLOADED);
    });
  });

  describe("quota_exhausted", () => {
    it("402 → quota_exhausted", () => {
      expect(classifyQuotaError(402, "Payment Required")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
    });
    it("429 ber-body quota → quota_exhausted (bukan rate_limited)", () => {
      expect(classifyQuotaError(429, "insufficient_quota: billing hard limit")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
      expect(classifyQuotaError(429, "quota exceeded for this key")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
      expect(classifyQuotaError(429, "credit_balance_exhausted")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
      expect(classifyQuotaError(429, "You have exceeded your quota")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
    });
    it("nuansa OpenRouter limit_source", () => {
      const body = (v) => JSON.stringify({ error: { message: "err", limit_source: v } });
      expect(classifyQuotaError(429, body("openrouter_credits"))).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
      expect(classifyQuotaError(402, body("openrouter_key_limit"))).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
      // in_flight_budget = rate limit biasa → boleh retry
      expect(classifyQuotaError(429, body("in_flight_budget"))).toBe(ERROR_CLASSES.RATE_LIMITED);
    });
  });

  describe("auth_error", () => {
    it("401 → auth_error", () => {
      expect(classifyQuotaError(401, "Unauthorized")).toBe(ERROR_CLASSES.AUTH_ERROR);
    });
    it("403 dengan penanda kredensial → auth_error", () => {
      expect(classifyQuotaError(403, "permission_denied")).toBe(ERROR_CLASSES.AUTH_ERROR);
      expect(classifyQuotaError(403, "entitlement check failed")).toBe(ERROR_CLASSES.AUTH_ERROR);
      expect(classifyQuotaError(403, "invalid_api_key provided")).toBe(ERROR_CLASSES.AUTH_ERROR);
    });
    it("403 polos → auth_error (keluarga otorisasi)", () => {
      expect(classifyQuotaError(403, "Forbidden")).toBe(ERROR_CLASSES.AUTH_ERROR);
    });
  });

  describe("policy_refusal", () => {
    it("403 content-policy → policy_refusal", () => {
      expect(classifyQuotaError(403, "content_policy_violation")).toBe(ERROR_CLASSES.POLICY_REFUSAL);
      expect(classifyQuotaError(400, JSON.stringify({ refusal: "I can't help with that" }))).toBe(
        ERROR_CLASSES.POLICY_REFUSAL
      );
    });
    it("body mengandung SAFETY (Gemini safety block) → policy_refusal", () => {
      expect(classifyQuotaError(400, JSON.stringify({ finishReason: "SAFETY" }))).toBe(
        ERROR_CLASSES.POLICY_REFUSAL
      );
    });
  });

  describe("server_error", () => {
    it("500/502 → server_error", () => {
      expect(classifyQuotaError(500, "Internal Server Error")).toBe(ERROR_CLASSES.SERVER_ERROR);
      expect(classifyQuotaError(502, "Bad Gateway")).toBe(ERROR_CLASSES.SERVER_ERROR);
    });
  });

  describe("payload_error", () => {
    it("400/404/413/415/422 → payload_error", () => {
      expect(classifyQuotaError(400, "Bad Request")).toBe(ERROR_CLASSES.PAYLOAD_ERROR);
      expect(classifyQuotaError(404, "Model not found")).toBe(ERROR_CLASSES.PAYLOAD_ERROR);
      expect(classifyQuotaError(413, "Payload Too Large")).toBe(ERROR_CLASSES.PAYLOAD_ERROR);
      expect(classifyQuotaError(415, "Unsupported Media Type")).toBe(ERROR_CLASSES.PAYLOAD_ERROR);
      expect(classifyQuotaError(422, "Unprocessable Entity")).toBe(ERROR_CLASSES.PAYLOAD_ERROR);
    });
  });

  describe("ignored", () => {
    it("499 selalu ignored — dievaluasi pertama tanpa kecuali", () => {
      expect(classifyQuotaError(499, "client closed request")).toBe(ERROR_CLASSES.IGNORED);
      // Bahkan bila body mengandung penanda kelas lain, 499 tetap menang.
      expect(classifyQuotaError(499, "SAFETY rate_limit_exceeded quota")).toBe(ERROR_CLASSES.IGNORED);
    });
  });

  describe("unknown & case-insensitive", () => {
    it("status tidak dikenal → unknown (netral)", () => {
      expect(classifyQuotaError(418, "I'm a teapot")).toBe(ERROR_CLASSES.UNKNOWN);
      expect(classifyQuotaError(408, "Request Timeout")).toBe(ERROR_CLASSES.UNKNOWN);
      expect(classifyQuotaError(undefined, "")).toBe(ERROR_CLASSES.UNKNOWN);
      expect(classifyQuotaError(null, null)).toBe(ERROR_CLASSES.UNKNOWN);
    });
    it("body match case-insensitive", () => {
      expect(classifyQuotaError(429, "RATE_LIMIT_EXCEEDED")).toBe(ERROR_CLASSES.RATE_LIMITED);
      expect(classifyQuotaError(429, "Quota Exceeded")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
      expect(classifyQuotaError(429, "MODEL IS OVERLOADED")).toBe(ERROR_CLASSES.OVERLOADED);
    });
  });

  describe("prioritas teks atas status", () => {
    it("429 ber-body quota tidak jatuh ke rate_limited", () => {
      expect(classifyQuotaError(429, "quota exceeded, rate limit ok")).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
    });
    it("403 ber-body content-policy tidak jatuh ke auth_error", () => {
      expect(classifyQuotaError(403, "content_policy_violation: blocked")).toBe(ERROR_CLASSES.POLICY_REFUSAL);
    });
  });
});

describe("settings.providerErrorRules (rule operator)", () => {
  const rules = [
    { provider: "fooai", match: "credits exhausted", errorClass: "quota_exhausted" },
  ];

  it("rule cocok bila provider sama persis dan substring ada di body", () => {
    expect(
      classifyQuotaError(429, "credits exhausted for key", { provider: "fooai", rules })
    ).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
  });
  it("match case-insensitive", () => {
    expect(
      classifyQuotaError(429, "CREDITS EXHAUSTED", { provider: "fooai", rules })
    ).toBe(ERROR_CLASSES.QUOTA_EXHAUSTED);
  });
  it("provider beda → jatuh ke aturan katalog (rule tidak berlaku)", () => {
    expect(
      classifyQuotaError(429, "credits exhausted for key", { provider: "barai", rules })
    ).toBe(ERROR_CLASSES.RATE_LIMITED);
  });
  it("rule operator menang atas aturan katalog bila provider cocok", () => {
    // Tanpa rule, 429 polos → rate_limited; rule mengarahkannya ke custom class.
    const custom = [{ provider: "fooai", match: "too many requests", errorClass: "overloaded" }];
    expect(classifyQuotaError(429, "Too Many Requests")).toBe(ERROR_CLASSES.RATE_LIMITED);
    expect(classifyQuotaError(429, "Too Many Requests", { provider: "fooai", rules: custom })).toBe(
      ERROR_CLASSES.OVERLOADED
    );
  });
  it("499 selalu menang atas rule operator", () => {
    expect(
      classifyQuotaError(499, "credits exhausted", { provider: "fooai", rules })
    ).toBe(ERROR_CLASSES.IGNORED);
  });
  it("tanpa provider atau tanpa rules → perilaku katalog (backward compatible)", () => {
    // "credits exhausted" bukan substring katalog ("credit_balance_exhausted"/"quota"),
    // jadi 429 ini → rate_limited; rule operator hanya aktif bila provider+rules diberikan.
    expect(classifyQuotaError(429, "credits exhausted for key")).toBe(ERROR_CLASSES.RATE_LIMITED);
    expect(classifyQuotaError(429, "credits exhausted for key", { provider: "fooai" })).toBe(
      ERROR_CLASSES.RATE_LIMITED
    );
  });

  describe("sanitizeProviderErrorRules (fail-open)", () => {
    it("bukan array → []", () => {
      expect(sanitizeProviderErrorRules(null)).toEqual([]);
      expect(sanitizeProviderErrorRules("x")).toEqual([]);
      expect(sanitizeProviderErrorRules({})).toEqual([]);
    });
    it("rule invalid di-skip: errorClass tidak dikenal, field kosong/hilang", () => {
      const raw = [
        { provider: "a", match: "x", errorClass: "quota_exhausted" },
        { provider: "a", match: "x", errorClass: "bukan_kelas" },
        { provider: "", match: "x", errorClass: "quota_exhausted" },
        { provider: "a", match: "", errorClass: "quota_exhausted" },
        { provider: "a", errorClass: "quota_exhausted" },
        null,
        "teks",
      ];
      expect(sanitizeProviderErrorRules(raw)).toEqual([
        { provider: "a", match: "x", errorClass: "quota_exhausted" },
      ]);
    });
    it("maksimal 50 rule; kelebihan dipotong", () => {
      const raw = Array.from({ length: 60 }, (_, i) => ({
        provider: `p${i}`,
        match: `m${i}`,
        errorClass: "rate_limited",
      }));
      const out = sanitizeProviderErrorRules(raw);
      expect(out).toHaveLength(MAX_PROVIDER_ERROR_RULES);
      expect(out[0].provider).toBe("p0");
      expect(out[49].provider).toBe("p49");
    });
    it("whitespace dirapikan, match dilowercase", () => {
      expect(
        sanitizeProviderErrorRules([{ provider: " a ", match: "  Foo  ", errorClass: " rate_limited " }])
      ).toEqual([{ provider: "a", match: "foo", errorClass: "rate_limited" }]);
    });
  });
});
