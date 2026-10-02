import { describe, it, expect, beforeEach } from "vitest";
import { recordRtkStats, getRtkMeter, resetRtkMeter } from "../../open-sse/rtk/meter.js";

describe("rtk meter", () => {
  beforeEach(() => resetRtkMeter());

  it("mengabaikan stats null (RTK disabled)", () => {
    recordRtkStats(null);
    const m = getRtkMeter();
    expect(m.requests).toBe(0);
  });

  it("mencatat request tanpa hits", () => {
    recordRtkStats({ bytesBefore: 100, bytesAfter: 100, hits: [] });
    const m = getRtkMeter();
    expect(m.requests).toBe(1);
    expect(m.requestsWithHits).toBe(0);
    expect(m.bytesSaved).toBe(0);
  });

  it("mengagregasi per filter dan per shape", () => {
    recordRtkStats({
      bytesBefore: 1000,
      bytesAfter: 600,
      hits: [
        { shape: "openai-tool", filter: "grep", saved: 250 },
        { shape: "openai-tool", filter: "grep", saved: 150 },
      ],
    });
    recordRtkStats({
      bytesBefore: 500,
      bytesAfter: 500,
      hits: [],
    });
    const m = getRtkMeter();
    expect(m.requests).toBe(2);
    expect(m.requestsWithHits).toBe(1);
    expect(m.bytesBefore).toBe(1500);
    expect(m.bytesAfter).toBe(1100);
    expect(m.bytesSaved).toBe(400);
    expect(m.byFilter.grep).toEqual({ hits: 2, saved: 400 });
    expect(m.byShape["openai-tool"]).toEqual({ hits: 2, saved: 400 });
    expect(m.hitRate).toBe(0.5);
  });

  it("reset mengosongkan akumulasi", () => {
    recordRtkStats({ bytesBefore: 100, bytesAfter: 50, hits: [{ shape: "x", filter: "y", saved: 50 }] });
    resetRtkMeter();
    const m = getRtkMeter();
    expect(m.requests).toBe(0);
    expect(m.bytesSaved).toBe(0);
    expect(m.byFilter).toEqual({});
  });
});
