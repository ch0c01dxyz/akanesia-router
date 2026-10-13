// Flag _compact tidak boleh bocor antar request: CodexExecutor di-cache
// sebagai singleton, jadi flag harus dibaca di awal execute() — bukan di
// transformRequest yang berjalan SETELAH buildUrl di base.execute().
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as proxyFetchModule from "../../open-sse/utils/proxyFetch.js";

const credentials = { connectionId: "fixture", accessToken: "fixture-token" };
afterEach(() => vi.restoreAllMocks());

describe("CodexExecutor _isCompact", () => {
  it("compact lalu normal pada executor yang sama menghasilkan URL yang benar untuk keduanya", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    const executor = new CodexExecutor();
    const args = (extra) => ({
      model: "gpt-5",
      body: { model: "gpt-5", input: "hi", ...extra },
      stream: false,
      credentials,
    });

    await executor.execute(args({ _compact: true }));
    await executor.execute(args({}));

    const urlCompact = String(fetchMock.mock.calls[0][0]);
    const urlNormal = String(fetchMock.mock.calls[1][0]);
    expect(urlCompact).toMatch(/\/compact$/);
    expect(urlNormal).not.toMatch(/\/compact/);
    expect(urlNormal).toMatch(/\/responses$/);
  });

  it("request normal pertama tidak mewarisi flag dari mana pun", async () => {
    const fetchMock = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue({
      ok: true, status: 200, headers: new Map(),
    });
    await new CodexExecutor().execute({
      model: "gpt-5",
      body: { model: "gpt-5", input: "hi" },
      stream: false,
      credentials,
    });
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/\/compact/);
  });
});
