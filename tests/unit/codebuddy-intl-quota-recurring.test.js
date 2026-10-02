// #4362: parseQuotaData punya `case "codebuddy-cn"` khusus yang meneruskan
// `recurring`, tapi tidak ada case untuk "codebuddy-intl" — padahal ia
// mengembalikan shape kuota yang persis sama
// (open-sse/services/usage/codebuddy-cn.js → getCodeBuddyIntlUsage).
// Jatuh ke `default` membuang `recurring`, sehingga bonus pack sekali pakai
// (recurring:false, resetAt = hard expiry) ter-render sebagai "Reset in"
// alih-alih "Expires in".
import { describe, expect, it } from "vitest";

import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const quotas = {
  Monthly: { used: 100, total: 1000, resetAt: "2026-11-01T00:00:00Z", recurring: true },
  "Bonus Pack 1": { used: 5, total: 50, resetAt: "2026-10-15T00:00:00Z", recurring: false },
};

function byName(parsed, name) {
  return parsed.find((q) => q.name === name);
}

describe("parseQuotaData meneruskan `recurring` untuk codebuddy-intl (#4362)", () => {
  it("menandai bonus pack sebagai non-recurring, seperti codebuddy-cn", () => {
    const intl = parseQuotaData("codebuddy-intl", { quotas });
    expect(byName(intl, "Bonus Pack 1").recurring).toBe(false);
    expect(byName(intl, "Monthly").recurring).toBe(true);
  });

  it("identik dengan codebuddy-cn untuk payload yang sama", () => {
    const cn = parseQuotaData("codebuddy-cn", { quotas });
    const intl = parseQuotaData("codebuddy-intl", { quotas });
    expect(intl).toEqual(cn);
  });
});
