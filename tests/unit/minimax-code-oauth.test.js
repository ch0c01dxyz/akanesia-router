import { describe, it, expect } from "vitest";
import { parsePlanWindows, parseMembership, signedAccountRequest } from "open-sse/services/usage/minimax-code.js";
import { createMinimaxCodeProvider, MINIMAX_CODE_SITES } from "@/lib/oauth/providers/minimax-code-shared.js";
import { getProvider } from "@/lib/oauth/providers/index.js";

describe("minimax-code OAuth provider", () => {
  it("terdaftar di PROVIDERS dengan flow device_code", () => {
    for (const id of ["minimax-code", "minimax-code-global"]) {
      const p = getProvider(id);
      expect(p.flowType).toBe("device_code");
      expect(p.config.clientId).toBe("mcode-public");
      expect(p.config.deviceUrl).toContain("oauth2/device/code");
    }
    expect(getProvider("minimax-code").config.deviceUrl).toContain("account.minimax.cn");
    expect(getProvider("minimax-code-global").config.deviceUrl).toContain("account.minimax.io");
  });

  it("mapTokens memetakan token dengan benar", () => {
    const p = createMinimaxCodeProvider(MINIMAX_CODE_SITES.cn);
    const m = p.mapTokens({ access_token: "a", refresh_token: "r", expires_in: 7200 });
    expect(m).toEqual({ accessToken: "a", refreshToken: "r", expiresIn: 7200 });
    expect(p.mapTokens({ access_token: "a" }).refreshToken).toBe("");
  });
});

describe("parsePlanWindows", () => {
  it("parse window interval + mingguan", () => {
    const body = {
      base_resp: { status_code: 0 },
      model_remains: [{
        model_name: "general",
        current_interval_remaining_percent: 80,
        current_interval_status: 1,
        start_time: 1700000000, end_time: 1700086400,
        current_weekly_remaining_percent: 50,
        current_weekly_status: 1,
        weekly_start_time: 1700000000, weekly_end_time: 1700604800,
      }],
    };
    const out = parsePlanWindows(body);
    expect(out).toHaveLength(2);
    expect(out[0].remaining).toBe(80);
    expect(out[0].used).toBe(20);
    expect(out[1].name).toContain("7 days");
  });

  it("melewatkan model yang habis total", () => {
    const body = {
      model_remains: [{
        model_name: "x", current_interval_status: 3, current_weekly_status: 3,
        current_interval_total_count: 0, current_weekly_total_count: 0,
      }],
    };
    expect(parsePlanWindows(body)).toEqual([]);
  });

  it("throw bila base_resp error", () => {
    expect(() => parsePlanWindows({ base_resp: { status_code: 400, status_msg: "bad" } }))
      .toThrow("bad");
  });
});

describe("parseMembership", () => {
  it("baca balance + tier + plan", () => {
    const m = parseMembership({
      data: { has_token_plan: true, token_plan_tier: "pro", token_plan_expires_at: 1899999999 },
      op_credit_summary: { total_remaining_amount: "123.45" },
    });
    expect(m).toMatchObject({ hasTokenPlan: true, tier: "pro", balance: "123.45", expiresAt: 1899999999 });
  });
});

describe("signedAccountRequest", () => {
  it("bangun URL + header signature", () => {
    const site = { agent: "https://agent.minimaxi.com", lang: "zh" };
    const { url, init } = signedAccountRequest(site, "/v1/api/user/info", { access: "tok", now: 1700000000000, tzOffsetSec: 25200 });
    expect(url).toContain("agent.minimaxi.com/v1/api/user/info");
    expect(url).toContain("device_platform=mcode");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers.yy).toMatch(/^[a-f0-9]{32}$/);
    expect(init.headers["x-signature"]).toMatch(/^[a-f0-9]{32}$/);
  });
});
