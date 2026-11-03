import { describe, expect, it, vi } from "vitest";
const chat = vi.hoisted(() => vi.fn());
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: chat }));
vi.mock("open-sse/translator/index.js", () => ({ initTranslators: vi.fn(async () => {}) }));
import { POST } from "@/app/api/v1/messages/route.js";

describe("Anthropic Messages error contract", () => {
  it.each([
    [400, "invalid_request_error"], [401, "authentication_error"], [402, "billing_error"],
    [403, "permission_error"], [404, "not_found_error"], [409, "conflict_error"],
    [413, "request_too_large"], [429, "rate_limit_error"], [500, "api_error"],
    [502, "api_error"], [503, "api_error"], [504, "timeout_error"], [529, "overloaded_error"],
  ])("returns the Anthropic envelope for HTTP %i", async (status, type) => {
    chat.mockResolvedValueOnce(Response.json({ error: { message: "test failure", type: "server_error" } }, {
      status, headers: { "retry-after": "30", "request-id": "req-test", "content-length": "1" },
    }));
    const res = await POST(new Request("http://localhost/v1/messages"));
    expect(res.status).toBe(status);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.has("content-length")).toBe(false);
    expect(await res.json()).toEqual({ type: "error", error: { type, message: "test failure" }, request_id: "req-test" });
  });

  it("leaves successful SSE streams unconsumed", async () => {
    const response = new Response("event: message_stop\n\n", { headers: { "content-type": "text/event-stream" } });
    chat.mockResolvedValueOnce(response);
    expect(await POST(new Request("http://localhost/v1/messages"))).toBe(response);
    expect(response.bodyUsed).toBe(false);
  });
});
