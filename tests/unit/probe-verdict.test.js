// Ide #5c "Probe LLM" — unit test agregasi verdict (P1..P6 → match/mismatch/
// uncertain/insufficient_data) + flags dimensi terpisah.
// Modul: open-sse/services/probe.js (kontrak dari worker backend).
//
// Aturan kontrak yang diuji:
// - mismatch: (P6 mismatch DAN P5 mismatch) ATAU (P6 mismatch DAN P1 claims-other)
// - uncertain: P6 uncertain, atau probe bertentangan, atau protocolMismatch
// - match: P6 match DAN P5 konsisten DAN tanpa anomali transport
// - insufficient_data: minValidSamples<2 ATAU >50% refusal ATAU call gagal
// - flags: P3 anomaly → billing_anomaly; P4 fake → transport_anomaly;
//   splitHalfJsd tinggi → backend_rotation. Kontrak: objek flags eksplisit
//   {billing_anomaly, transport_anomaly, backend_rotation} (boolean).
// - insufficient_data: minValidSamples<2 ATAU refusalRatio>0.5 (eksplisit, atau
//   diturunkan dari status "refusal" tiap probe) ATAU failedCalls>0.
import { describe, it, expect } from "vitest";
import { aggregateVerdict } from "open-sse/services/probe.js";

const sel = (nama, jsd, splitHalfJsd) => ({
  cell: nama,
  jsd,
  splitHalfJsd,
  validSamples: 3,
});

const masukanCocok = () => ({
  p1: { status: "exact", text: "gpt-4o", claimedOther: false },
  p2: { status: "match", text: "2024-10" },
  p3: { charsPerToken: 4.1, usageRatio: 1.0, anomaly: false, estimated: 410 },
  p4: { ttftMs: 180, totalMs: 1600, chunkCount: 42, fake: false },
  p5: { scoreVsRef: 0.92, rankOfClaimed: 1, consistent: true },
  p6: {
    cells: [sel("random-number-1-100:en", 0.09, 0.12), sel("random-color:en", 0.11, 0.1)],
    meanJsd: 0.1,
    verdict: "match",
    minValidSamples: 3,
  },
  protocolMismatch: false,
});

const pastikanAlasan = (hasil) => {
  expect(Array.isArray(hasil.reasons)).toBe(true);
  expect(hasil.reasons.length).toBeGreaterThan(0);
  for (const r of hasil.reasons) expect(typeof r).toBe("string");
};

const pastikanConfidence = (hasil) => {
  expect(hasil.confidence).toBeGreaterThanOrEqual(0);
  expect(hasil.confidence).toBeLessThanOrEqual(1);
};

describe("skenario genuine → match", () => {
  it('P6 match + P5 konsisten + tanpa anomali → verdict "match", confidence ≥ 0.9', () => {
    const hasil = aggregateVerdict(masukanCocok());
    expect(hasil.verdict).toBe("match");
    expect(hasil.confidence).toBeGreaterThanOrEqual(0.9);
    pastikanConfidence(hasil);
  });

  it("semua flags false dan reasons terisi", () => {
    const hasil = aggregateVerdict(masukanCocok());
    expect(hasil.flags).toEqual({
      billing_anomaly: false,
      transport_anomaly: false,
      backend_rotation: false,
    });
    pastikanAlasan(hasil);
  });
});

describe("skenario masked → mismatch", () => {
  const masukanMasked = () => ({
    ...masukanCocok(),
    p1: { status: "claims-other", text: "claude-3-5-sonnet", claimedOther: true },
    p5: { scoreVsRef: 0.35, rankOfClaimed: 3, consistent: false },
    p6: {
      cells: [sel("random-number-1-100:en", 0.48, 0.12), sel("random-color:en", 0.52, 0.1)],
      meanJsd: 0.5,
      verdict: "mismatch",
      minValidSamples: 3,
    },
  });

  it("P6 mismatch + P1 claims-other → mismatch", () => {
    const hasil = aggregateVerdict(masukanMasked());
    expect(hasil.verdict).toBe("mismatch");
    pastikanConfidence(hasil);
    pastikanAlasan(hasil);
  });

  it("P6 mismatch + P5 mismatch (tanpa klaim P1) → tetap mismatch", () => {
    const input = masukanMasked();
    input.p1 = { status: "exact", text: "gpt-4o", claimedOther: false };
    const hasil = aggregateVerdict(input);
    expect(hasil.verdict).toBe("mismatch");
    pastikanAlasan(hasil);
  });
});

describe("skenario inconclusive → insufficient_data (bukan throw)", () => {
  it("minValidSamples < 2 → insufficient_data tanpa throw", () => {
    const input = masukanCocok();
    input.p6.minValidSamples = 1;
    expect(() => aggregateVerdict(input)).not.toThrow();
    expect(aggregateVerdict(input).verdict).toBe("insufficient_data");
  });

  it(">50% refusal (status probe) → insufficient_data", () => {
    const input = masukanCocok();
    input.p1 = { status: "refusal", text: "", claimedOther: false };
    input.p2 = { status: "refusal", text: "" };
    const hasil = aggregateVerdict(input);
    expect(hasil.verdict).toBe("insufficient_data");
    pastikanAlasan(hasil);
  });

  it("refusalRatio eksplisit > 0.5 → insufficient_data", () => {
    const input = { ...masukanCocok(), refusalRatio: 0.6 };
    const hasil = aggregateVerdict(input);
    expect(hasil.verdict).toBe("insufficient_data");
    pastikanAlasan(hasil);
  });

  it("call gagal (failedCalls > 0) → insufficient_data", () => {
    const input = { ...masukanCocok(), failedCalls: 2 };
    const hasil = aggregateVerdict(input);
    expect(hasil.verdict).toBe("insufficient_data");
    pastikanAlasan(hasil);
  });
});

describe("skenario uncertain", () => {
  it("P6 uncertain → uncertain", () => {
    const input = masukanCocok();
    input.p6.verdict = "uncertain";
    input.p6.meanJsd = 0.3;
    expect(aggregateVerdict(input).verdict).toBe("uncertain");
  });

  it("protocolMismatch:true → uncertain walau semua probe cocok", () => {
    const input = masukanCocok();
    input.protocolMismatch = true;
    const hasil = aggregateVerdict(input);
    expect(hasil.verdict).toBe("uncertain");
    pastikanAlasan(hasil);
  });

  it("probe bertentangan (P6 match tapi P5 inkonsisten) → uncertain", () => {
    const input = masukanCocok();
    input.p5 = { scoreVsRef: 0.4, rankOfClaimed: 3, consistent: false };
    expect(aggregateVerdict(input).verdict).toBe("uncertain");
  });
});

describe("flags dimensi terpisah", () => {
  it("P3 anomaly → billing_anomaly true (identitas tetap match)", () => {
    const input = masukanCocok();
    input.p3 = { charsPerToken: 2.4, usageRatio: 1.6, anomaly: true, estimated: 410 };
    const hasil = aggregateVerdict(input);
    expect(hasil.flags.billing_anomaly).toBe(true);
    expect(hasil.flags.transport_anomaly).toBe(false);
    expect(hasil.flags.backend_rotation).toBe(false);
    expect(hasil.verdict).toBe("match");
  });

  it("P4 fake → transport_anomaly true dan verdict bukan match", () => {
    const input = masukanCocok();
    input.p4 = { ttftMs: 1520, totalMs: 1600, chunkCount: 1, fake: true };
    const hasil = aggregateVerdict(input);
    expect(hasil.flags.transport_anomaly).toBe(true);
    // Kontrak: match mensyaratkan tanpa anomali transport.
    expect(hasil.verdict).not.toBe("match");
    pastikanAlasan(hasil);
  });

  it("splitHalfJsd tinggi di salah satu cell → backend_rotation true", () => {
    const input = masukanCocok();
    input.p6.cells = [
      sel("random-number-1-100:en", 0.09, 0.7),
      sel("random-color:en", 0.11, 0.1),
    ];
    const hasil = aggregateVerdict(input);
    expect(hasil.flags.backend_rotation).toBe(true);
    pastikanAlasan(hasil);
  });
});
