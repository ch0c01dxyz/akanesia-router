import { describe, expect, it } from "vitest";

import {
  OPENCODE_GATE_ANCHOR_TOOL,
  OPENCODE_GATE_ANCHOR_HEADERS,
  checkGateAnchors,
} from "../../open-sse/config/opencodeGateAnchors.js";
import { OPENCODE_FINGERPRINT_TOOLS } from "../../open-sse/utils/opencodeFingerprint.js";

describe("opencode gate anchors (P3)", () => {
  it("fingerprint tools selalu memuat anchor tool 'read'", () => {
    expect(OPENCODE_FINGERPRINT_TOOLS).toContain(OPENCODE_GATE_ANCHOR_TOOL);
  });

  it("checkGateAnchors lolos bila semua anchor ada", () => {
    const warnings = checkGateAnchors({
      headers: {
        "User-Agent": "opencode/latest/2.0.26/cli",
        "x-opencode-session": "ses_abc",
        "x-session-affinity": "ses_abc",
      },
      tools: [{ function: { name: "read" } }, { function: { name: "shell" } }],
    });
    expect(warnings).toEqual([]);
  });

  it("checkGateAnchors melapor bila anchor hilang", () => {
    const warnings = checkGateAnchors({
      headers: { "x-opencode-session": "ses_abc" },
      tools: [{ function: { name: "shell" } }],
    });
    expect(warnings).toContain("missing gate header: user-agent");
    expect(warnings).toContain("missing gate header: x-session-affinity");
    expect(warnings).toContain('missing gate tool: "read"');
    // header yang ada tidak dilaporkan
    expect(warnings).not.toContain("missing gate header: x-opencode-session");
  });

  it("checkGateAnchors tahan terhadap input kosong", () => {
    const warnings = checkGateAnchors({});
    expect(warnings.length).toBe(
      OPENCODE_GATE_ANCHOR_HEADERS.length + 1
    );
  });
});
