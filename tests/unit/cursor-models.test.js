import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const transport = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("http2", () => ({ default: { connect: transport.connect } }));
import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";

const originalFetch = global.fetch;

function mockCatalog(status, payload, pending = false) {
  const request = new EventEmitter();
  request.close = vi.fn();
  request.end = vi.fn(() => {
    if (pending) return;
    queueMicrotask(() => {
      request.emit("response", { ":status": status });
      if (payload) request.emit("data", Buffer.from(payload));
      request.emit("end");
    });
  });
  const client = new EventEmitter();
  client.request = vi.fn(() => request);
  client.destroy = vi.fn();
  transport.connect.mockReturnValue(client);
  return { request, client };
}

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    transport.connect.mockReset();
    clearCursorModelCache();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    clearCursorModelCache();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("fetches the account-specific catalog and caches it", async () => {
    const payload = concat(model("claude-4.6-opus", "Claude 4.6 Opus"));
    const { request, client } = mockCatalog(200, payload);
    const credentials = {
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    };

    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });
    await expect(resolveCursorModels(credentials)).resolves.toEqual({
      models: [{ id: "claude-4.6-opus", name: "Claude 4.6 Opus" }],
    });

    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh");
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      ":method": "POST", ":path": "/agent.v1.AgentService/GetUsableModels",
      "content-type": "application/proto", accept: "application/proto",
    }));
    expect(request.end).toHaveBeenCalled();
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it("fails open when the Cursor catalog request fails", async () => {
    mockCatalog(403);

    await expect(resolveCursorModels({
      accessToken: "cursor-token",
      providerSpecificData: { machineId: "machine-id" },
    })).resolves.toBeNull();
  });

  it("closes the request and HTTP/2 session on abort without caching a result", async () => {
    const { client, request } = mockCatalog(200, null, true);
    const controller = new AbortController();
    const result = resolveCursorModels({ accessToken: "token", providerSpecificData: { machineId: "machine" } }, { signal: controller.signal });
    controller.abort();
    await expect(result).resolves.toBeNull();
    expect(request.close).toHaveBeenCalledOnce();
    expect(client.destroy).toHaveBeenCalledOnce();
  });

  it("destroys a stalled HTTP/2 session when the catalog deadline expires", async () => {
    vi.useFakeTimers();
    const { client, request } = mockCatalog(200, null, true);
    const result = resolveCursorModels({ accessToken: "token", providerSpecificData: { machineId: "machine" } });
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeNull();
    expect(request.close).toHaveBeenCalledOnce();
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
