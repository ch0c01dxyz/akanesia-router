import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModelsCache, getOrBuildModelsCache, invalidateModelsCache } from "../../src/lib/modelsCache.js";

beforeEach(() => invalidateModelsCache());

describe("model catalog concurrent builds", () => {
  it("shares one build across equivalent simultaneous requests", async () => {
    const build = vi.fn(async () => [{ id: "model" }]);
    const results = await Promise.all([
      getOrBuildModelsCache(["llm", "image"], false, build),
      getOrBuildModelsCache(["image", "llm"], false, build),
    ]);
    expect(build).toHaveBeenCalledOnce();
    expect(results[0]).toBe(results[1]);
    expect(getModelsCache(["llm", "image"], false)).toBe(results[0]);
  });

  it("does not cache failures and allows the next request to rebuild", async () => {
    await expect(getOrBuildModelsCache(["llm"], false, () => Promise.reject(new Error("offline"))))
      .rejects.toThrow("offline");
    expect(await getOrBuildModelsCache(["llm"], false, async () => [])).toEqual([]);
  });

  it("does not let an old build overwrite a catalog invalidated mid-flight", async () => {
    let finishOld;
    const old = getOrBuildModelsCache(["llm"], false, () => new Promise(resolve => { finishOld = resolve; }));
    await Promise.resolve();
    invalidateModelsCache();
    const fresh = await getOrBuildModelsCache(["llm"], false, async () => [{ id: "fresh" }]);
    finishOld([{ id: "stale" }]);
    await old;
    expect(getModelsCache(["llm"], false)).toBe(fresh);
  });

  it("keeps dynamic and recursion-safe catalog builds separate", async () => {
    const dynamic = await getOrBuildModelsCache(["llm"], false, async () => ["dynamic"]);
    const safe = await getOrBuildModelsCache(["llm"], true, async () => ["safe"]);
    expect(dynamic).toEqual(["dynamic"]);
    expect(safe).toEqual(["safe"]);
  });
});
