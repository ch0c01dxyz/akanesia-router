import { describe, it, expect, vi, afterEach } from "vitest";
import {
  tokensPerSecond,
  attachTokensPerSecond,
  filterUsageForFormat,
} from "../../open-sse/utils/usageTracking.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tokensPerSecond", () => {
  it("2 token dalam 1000ms → 2 tok/s", () => {
    expect(tokensPerSecond(2, 1000)).toBe(2);
  });

  it("hanya memakai durasi generasi — TTFT tidak ikut dihitung", () => {
    // Total 5000ms sejak request masuk, tapi generasi cuma 1000ms:
    // hasilnya 2 tok/s, bukan 0.4 (bila total latency yang dipakai).
    const out = attachTokensPerSecond({ prompt_tokens: 100, completion_tokens: 2 }, 1000);
    expect(out.tokens_per_second).toBe(2);
  });

  it("mengenali varian nama field output (Claude/Gemini)", () => {
    expect(attachTokensPerSecond({ output_tokens: 4 }, 2000).tokens_per_second).toBe(2);
    expect(attachTokensPerSecond({ candidatesTokenCount: 6 }, 3000).tokens_per_second).toBe(2);
  });

  it("membulatkan ke 3 desimal", () => {
    expect(attachTokensPerSecond({ completion_tokens: 3 }, 700).tokens_per_second).toBe(4.286);
  });

  it("omit (bukan 0/Infinity) bila durasi tak diketahui — jangan menebak", () => {
    for (const ms of [null, undefined, 0, -5, NaN]) {
      expect(attachTokensPerSecond({ completion_tokens: 2 }, ms)).not.toHaveProperty("tokens_per_second");
    }
  });

  it("omit bila tidak ada output token", () => {
    expect(attachTokensPerSecond({ prompt_tokens: 10, completion_tokens: 0 }, 1000)).not.toHaveProperty(
      "tokens_per_second"
    );
    expect(attachTokensPerSecond({ prompt_tokens: 10 }, 1000)).not.toHaveProperty("tokens_per_second");
  });

  it("usage non-objek diteruskan apa adanya", () => {
    expect(attachTokensPerSecond(null, 1000)).toBeNull();
    expect(attachTokensPerSecond("x", 1000)).toBe("x");
  });

  it("tidak mengubah field yang sudah ada (non-breaking)", () => {
    const out = attachTokensPerSecond({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }, 1000);
    expect(out).toMatchObject({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, tokens_per_second: 2 });
  });
});

describe("filterUsageForFormat", () => {
  it("mempertahankan tokens_per_second untuk format OpenAI & Claude", () => {
    expect(
      filterUsageForFormat({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, tokens_per_second: 2 }, FORMATS.OPENAI)
    ).toMatchObject({ tokens_per_second: 2, completion_tokens: 2 });
    expect(
      filterUsageForFormat({ input_tokens: 5, output_tokens: 2, tokens_per_second: 2 }, FORMATS.CLAUDE)
    ).toMatchObject({ tokens_per_second: 2, output_tokens: 2 });
  });
});

describe("stream passthrough: tokens_per_second di usage SSE", () => {
  // Catatan: tiap baris input "\n\n" menghasilkan 2 output (baris data + echo
  // baris kosong), dan TransformStream menerapkan backpressure — jadi tulis
  // tanpa await, lalu baca HINGGA penanda konten terlihat. Begitu penanda
  // muncul, transform chunk tersebut pasti sudah selesai (writes diproses
  // berurutan), sehingga mock Date.now tetap deterministik.
  const siapkan = (onComplete) => {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const ts = createPassthroughStreamWithLogger("test-provider", null, "test-model", "conn-1", {}, onComplete, null);
    const writer = ts.writable.getWriter();
    const reader = ts.readable.getReader();
    const tulis = (str) => {
      writer.write(enc.encode(str));
    };
    const bacaHingga = async (penanda) => {
      let out = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return out;
        out += dec.decode(value);
        if (out.includes(penanda)) return out;
      }
    };
    const tutupDanKuras = async () => {
      // close() menunggu writes selesai; writes menunggu queue dibaca
      // (backpressure) — jadi baca dulu hingga done, baru await close.
      const closing = writer.close();
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
      }
      await closing;
    };
    const usageDari = (out) => {
      const baris = out.split("\n").find((l) => l.includes("finish_reason"));
      return JSON.parse(baris.slice(baris.indexOf("data:") + 5).trim()).usage;
    };
    return { tulis, bacaHingga, tutupDanKuras, usageDari };
  };

  it("dihitung sejak token konten pertama — TTFT dikecualikan", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let completedUsage = null;
    const { tulis, bacaHingga, tutupDanKuras, usageDari } = siapkan((_c, usage) => {
      completedUsage = usage;
    });

    // TTFT 2000ms: token konten pertama keluar pada t=+2000
    now += 2000;
    tulis(
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Halo"},"finish_reason":null}]}\n\n'
    );
    await bacaHingga("Halo"); // transform selesai → penanda token pertama tercatat

    // Finish pada t=+3000 → durasi generasi 1000ms untuk 2 token → 2 tok/s
    // (bila TTFT ikut dihitung hasilnya 0.667)
    now += 1000;
    tulis(
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n'
    );
    const clientUsage = usageDari(await bacaHingga("finish_reason"));
    expect(clientUsage.completion_tokens).toBe(2);
    expect(clientUsage.tokens_per_second).toBe(2);

    tulis("data: [DONE]\n\n");
    await tutupDanKuras();

    // Server-side (onStreamComplete → log/DB) membawa metrik yang sama
    expect(completedUsage.tokens_per_second).toBe(2);
  });

  it("field di-omit bila stream tanpa token konten", async () => {
    let now = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let completedUsage = null;
    const { tulis, bacaHingga, tutupDanKuras, usageDari } = siapkan((_c, usage) => {
      completedUsage = usage;
    });

    tulis(
      'data: {"id":"chatcmpl-abc12345","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":0,"total_tokens":10}}\n\n'
    );
    expect(usageDari(await bacaHingga("finish_reason"))).not.toHaveProperty("tokens_per_second");

    tulis("data: [DONE]\n\n");
    await tutupDanKuras();
    expect(completedUsage).not.toHaveProperty("tokens_per_second");
  });
});
