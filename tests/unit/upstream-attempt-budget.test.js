import { afterEach, describe, expect, it, vi } from "vitest";
import { executeUpstream } from "../../open-sse/handlers/chatCore.js";

afterEach(() => vi.useRealTimers());

describe("upstream header budget", () => {
  it("aborts a pending fetch when the deadline expires", async () => {
    vi.useFakeTimers();
    const executor = { execute: vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const result = executeUpstream(executor, {}, Date.now() + 100);
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the deadline at headers and keeps the body readable", async () => {
    vi.useFakeTimers();
    let signal;
    const result = await executeUpstream({ execute: async (options) => {
      signal = options.signal;
      return { response: new Response("stream body") };
    } }, {}, Date.now() + 100);
    await vi.advanceTimersByTimeAsync(200);
    expect(signal.aborted).toBe(false);
    expect(await result.response.text()).toBe("stream body");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates the supplied single-account client signal", async () => {
    const controller = new AbortController();
    let upstreamSignal;
    await executeUpstream({ execute: async ({ signal }) => { upstreamSignal = signal; } }, {}, undefined, controller.signal);
    controller.abort();
    expect(upstreamSignal.aborted).toBe(true);
  });

  it("does not call the executor after the deadline", async () => {
    const executor = { execute: vi.fn() };
    await expect(executeUpstream(executor, {}, Date.now() - 1)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
