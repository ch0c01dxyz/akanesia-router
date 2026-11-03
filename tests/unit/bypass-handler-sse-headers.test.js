/**
 * The Claude-CLI bypass response is a synthetic SSE stream built in
 * bypassHandler, bypassing the central header path (streamingHandler uses
 * SSE_HEADERS_CORS). Without X-Accel-Buffering: no, a buffering reverse
 * proxy can sit on the bypass stream for its buffer window.
 */

import { describe, it, expect } from "vitest";
import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

describe("bypassHandler synthetic SSE response headers", () => {
  it("sets X-Accel-Buffering: no on the streaming bypass response", () => {
    const out = handleBypassRequest(
      { messages: [{ role: "user", content: "count" }] },
      "claude-sonnet-4.5",
      "claude-cli/1.0",
    );

    expect(out).not.toBeNull();
    expect(out.success).toBe(true);
    expect(out.response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(out.response.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("does not bypass non-Claude-CLI requests", () => {
    const out = handleBypassRequest(
      { messages: [{ role: "user", content: "count" }] },
      "claude-sonnet-4.5",
      "Mozilla/5.0",
    );

    expect(out).toBeNull();
  });
});
