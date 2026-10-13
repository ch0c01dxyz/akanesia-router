// Body error upstream dibaca terbatas 16 KB — bukan response.text() tanpa batas
// (risiko memory exhaustion bila upstream mengirim body raksasa).
import { describe, it, expect } from "vitest";
import { parseUpstreamError } from "../../open-sse/utils/error.js";
import { bacaBodyTerbatas, BATAS_BACA_BODY_ERROR } from "../../open-sse/utils/bacaBodyTerbatas.js";

function streamResponse(text, status = 500) {
  const data = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({ start(c) { c.enqueue(data); c.close(); } }),
    { status, headers: { "content-type": "text/plain" } }
  );
}

describe("bacaBodyTerbatas", () => {
  it("memotong body 1MB menjadi 16KB", async () => {
    const out = await bacaBodyTerbatas(streamResponse("x".repeat(1024 * 1024)));
    expect(out.length).toBe(BATAS_BACA_BODY_ERROR);
  });

  it("fail-open bila tidak ada body stream", async () => {
    expect(await bacaBodyTerbatas(null)).toBe("");
    expect(await bacaBodyTerbatas({})).toBe("");
  });
});

describe("parseUpstreamError", () => {
  it("tidak mem-buffer seluruh body raksasa", async () => {
    const res = await parseUpstreamError(streamResponse("e".repeat(1024 * 1024)));
    expect(res.statusCode).toBe(500);
    expect(res.message.length).toBeLessThanOrEqual(BATAS_BACA_BODY_ERROR);
  });

  it("tetap parse JSON error kecil seperti biasa", async () => {
    const res = await parseUpstreamError(
      streamResponse(JSON.stringify({ error: { message: "boom" } }), 429)
    );
    expect(res.statusCode).toBe(429);
    expect(res.message).toBe("boom");
  });
});
