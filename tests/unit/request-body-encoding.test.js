import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  normalizeContentEncoding,
  decodeRequestBodyBytes,
  parseJsonRequestBody,
} from "../../src/lib/requestBodyEncoding.js";

function fakeRequest({ encoding = null, bodyBuffer = null, jsonValue = null } = {}) {
  return {
    headers: new Headers(encoding ? { "content-encoding": encoding } : {}),
    arrayBuffer: async () => bodyBuffer,
    json: async () => jsonValue,
  };
}

describe("normalizeContentEncoding", () => {
  it("treats absent and identity encodings as uncompressed", () => {
    expect(normalizeContentEncoding(null)).toBeNull();
    expect(normalizeContentEncoding("")).toBeNull();
    expect(normalizeContentEncoding("identity")).toBeNull();
  });

  it("lower-cases and trims the token", () => {
    expect(normalizeContentEncoding("GZIP ")).toBe("gzip");
    expect(normalizeContentEncoding("Deflate")).toBe("deflate");
  });
});

describe("decodeRequestBodyBytes", () => {
  const payload = Buffer.from(JSON.stringify({ model: "x", messages: [] }));

  it("round-trips gzip, x-gzip, deflate and brotli", async () => {
    const cases = [
      ["gzip", zlib.gzipSync(payload)],
      ["x-gzip", zlib.gzipSync(payload)],
      ["deflate", zlib.deflateSync(payload)],
      ["br", zlib.brotliCompressSync(payload)],
    ];
    for (const [encoding, bytes] of cases) {
      const result = await decodeRequestBodyBytes(bytes, encoding, 1024 * 1024);
      expect(result.ok).toBe(true);
      if (result.ok) expect(Buffer.from(result.body).toString()).toBe(payload.toString());
    }
  });

  it("rejects unknown and stacked encodings without throwing", async () => {
    expect(await decodeRequestBodyBytes(payload, "compress", 1024 * 1024)).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(await decodeRequestBodyBytes(payload, "gzip, deflate", 1024 * 1024)).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("reports corrupt compressed data as invalid, never leaking zlib detail", async () => {
    const result = await decodeRequestBodyBytes(Buffer.from("not-compressed"), "gzip", 1024 * 1024);
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("caps decompressed output (bomb guard)", async () => {
    const big = zlib.gzipSync(Buffer.alloc(10000, "a"));
    const result = await decodeRequestBodyBytes(big, "gzip", 100);
    expect(result).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("parseJsonRequestBody", () => {
  it.each([null, [], "text", 42, true])("rejects non-object JSON %j before chat admission", async body => {
    await expect(parseJsonRequestBody(fakeRequest({ jsonValue: body })))
      .rejects.toThrow("Request body must be a JSON object");
    await expect(parseJsonRequestBody(fakeRequest({ encoding: "gzip",
      bodyBuffer: zlib.gzipSync(Buffer.from(JSON.stringify(body))) })))
      .rejects.toThrow("Request body must be a JSON object");
  });
  it("passes uncompressed bodies through request.json() untouched", async () => {
    const body = { model: "x", stream: false };
    await expect(parseJsonRequestBody(fakeRequest({ jsonValue: body }))).resolves.toEqual(body);
  });

  it("decodes a gzip body before JSON parsing", async () => {
    const body = { model: "x", messages: [{ role: "user", content: "hi" }] };
    const request = fakeRequest({
      encoding: "gzip",
      bodyBuffer: zlib.gzipSync(Buffer.from(JSON.stringify(body))),
    });
    await expect(parseJsonRequestBody(request)).resolves.toEqual(body);
  });

  it("throws a generic error for unsupported encodings and corrupt bodies", async () => {
    const unsupported = fakeRequest({ encoding: "zstd-unknown", bodyBuffer: Buffer.from("{}") });
    await expect(parseJsonRequestBody(unsupported)).rejects.toThrow("Request body decoding failed");

    const corrupt = fakeRequest({ encoding: "gzip", bodyBuffer: Buffer.from("garbage") });
    await expect(parseJsonRequestBody(corrupt)).rejects.toThrow("Request body decoding failed");
  });
});
