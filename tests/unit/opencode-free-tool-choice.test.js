import { describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => "" } })),
}));

// Break caught: opencode/muse-spark-1.3-contributor-free 400 vì upstream
// chỉ nhận tool_choice "auto"; named/required/none phải demote sang "auto".
const FREE_13 = "muse-spark-1.3-contributor-free";
const CREDS = { connectionId: "opencode-free-tool-choice-test" };
const INPUT = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }];
const TOOLS = [{ type: "function", name: "get_weather", description: "w", parameters: { type: "object", properties: {} } }];

function responsesBody(model, tool_choice) {
  const body = { model, input: structuredClone(INPUT), tools: structuredClone(TOOLS) };
  if (tool_choice !== undefined) body.tool_choice = tool_choice;
  return body;
}

describe("opencode Free tool_choice handling (PR #83)", () => {
  it("deletes explicit 'none' (gate rejects it); defaults to auto; passes through others", () => {
    const noneOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, "none"), true, CREDS,
    );
    // PR #83: 'none' is deleted then defaulted to 'auto' (gate needs tools declared).
    expect(noneOut.tool_choice).toBe("auto");
    // Genuine fingerprint tools are injected.
    expect(noneOut.tools.length).toBeGreaterThan(TOOLS.length);

    // Named/auto pass through unchanged (no forced demotion).
    for (const choice of ["auto", { type: "function", name: "get_weather" }]) {
      const out = new OpenCodeExecutor().transformRequest(
        FREE_13, responsesBody(FREE_13, structuredClone(choice)), true, CREDS,
      );
      expect(out.tool_choice).toEqual(choice);
    }
  });

  it("giữ auto và absent; tools/input nguyên vẹn (plus genuine fingerprint tools)", () => {
    const autoOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, "auto"), true, CREDS,
    );
    expect(autoOut.tool_choice).toBe("auto");
    // PR #83: user tools preserved, genuine fingerprint tools appended.
    expect(autoOut.tools.length).toBeGreaterThan(TOOLS.length);
    expect(autoOut.input).toEqual(INPUT);

    const absentOut = new OpenCodeExecutor().transformRequest(
      FREE_13, responsesBody(FREE_13, undefined), true, CREDS,
    );
    // PR #83: absent defaults to 'auto' with genuine tools injected.
    expect(absentOut.tool_choice).toBe("auto");
    expect(absentOut.tools.length).toBeGreaterThan(0);
    expect(absentOut.input).toEqual(INPUT);
  });

  it.each([
    ["1.2-Free", "muse-spark-1.2-contributor-free"],
    ["future 1.4-Free", "muse-spark-1.4-contributor-free"],
    ["Go id", "muse-spark-1.3-contributor"],
    ["non-Muse", "big-pickle"],
  ])("không đổi tool_choice của %s", (_label, model) => {
    const choice = { type: "function", name: "get_weather" };
    const body = responsesBody(model, structuredClone(choice));
    const out = new OpenCodeExecutor().transformRequest(model, body, true, CREDS);
    expect(out.tool_choice).toEqual(choice);
  });

  it("wire: execute sends tool_choice through to /inference/v1/responses", async () => {
    proxyAwareFetch.mockClear();
    const ex = new OpenCodeExecutor();
    const body = responsesBody(FREE_13, { type: "function", name: "get_weather" });
    const { url, transformedBody } = await ex.execute({
      model: FREE_13, body, stream: true, credentials: CREDS,
    });
    expect(url).toBe("https://opencode.ai/inference/v1/responses");
    expect(transformedBody.tool_choice).toEqual({ type: "function", name: "get_weather" });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [actualUrl, actualInit] = proxyAwareFetch.mock.calls[0];
    expect(actualUrl).toBe("https://opencode.ai/inference/v1/responses");
    const sent = JSON.parse(actualInit.body);
    expect(sent.tool_choice).toEqual({ type: "function", name: "get_weather" });
    expect(sent.model).toBe(FREE_13);
    // PR #83: user tools preserved, genuine fingerprint tools appended.
    expect(sent.tools.length).toBeGreaterThan(TOOLS.length);
    expect(sent.tools.slice(0, TOOLS.length)).toEqual(TOOLS);
    expect(sent.input).toEqual(INPUT);
  });
});
