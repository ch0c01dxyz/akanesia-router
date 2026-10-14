import { describe, it, expect } from "vitest";
import {
  generateRequestId,
  OPENCODE_REQUEST_RE,
} from "../../open-sse/executors/opencode-zen.js";

describe("opencode-zen request id", () => {
  it("generateRequestId menghasilkan format msg_* yang valid", () => {
    const id = generateRequestId();
    expect(OPENCODE_REQUEST_RE.test(id)).toBe(true);
  });

  it("generateRequestId unik antar panggilan", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
  });
});
