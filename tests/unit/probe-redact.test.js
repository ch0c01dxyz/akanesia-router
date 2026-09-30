// Ide #5c "Probe LLM" — unit test anti-bocor secret + loadReferenceFingerprint.
// Modul: open-sse/services/probe.js (kontrak dari worker backend).
// - Bila service mengekspor stripSecrets (atau nama sejenis), fungsi itu diuji.
// - Bila tidak, diuji bahwa aggregateVerdict/helper tidak membocorkan kredensial
//   yang disisipkan di input ke dalam output.
// - loadReferenceFingerprint: null bila file tidak ada / placeholder:true;
//   menolak path traversal.
import { describe, it, expect } from "vitest";
import * as probe from "open-sse/services/probe.js";

const { aggregateVerdict, loadReferenceFingerprint } = probe;
const API_KEY_PALSU = "sk-TEST-123";

const masukanCocok = () => ({
  p1: { status: "exact", text: "gpt-4o", claimedOther: false },
  p2: { status: "match", text: "2024-10" },
  p3: { charsPerToken: 4.1, usageRatio: 1.0, anomaly: false, estimated: 410 },
  p4: { ttftMs: 180, totalMs: 1600, chunkCount: 42, fake: false },
  p5: { scoreVsRef: 0.92, rankOfClaimed: 1, consistent: true },
  p6: {
    cells: [
      { cell: "random-number-1-100:en", jsd: 0.09, splitHalfJsd: 0.12, validSamples: 3 },
      { cell: "random-color:en", jsd: 0.11, splitHalfJsd: 0.1, validSamples: 3 },
    ],
    meanJsd: 0.1,
    verdict: "match",
    minValidSamples: 3,
  },
  protocolMismatch: false,
});

// Bila service mengekspor fungsi sanitasi (mis. stripSecrets), uji langsung;
// bila tidak ada, blok ini di-skip dan uji anti-bocor di bawah yang berlaku.
const adaSanitasi = typeof probe.stripSecrets === "function";
(adaSanitasi ? describe : describe.skip)("stripSecrets (bila diekspor service)", () => {
  it("menghapus nilai secret dari output", () => {
    const hasil = probe.stripSecrets({
      model: "gpt-4o",
      apiKey: API_KEY_PALSU,
      nested: { token: "tok-RAHASIA-xyz", count: 3 },
    });
    expect(hasil).toBeDefined();
    const json = JSON.stringify(hasil);
    expect(json).not.toContain(API_KEY_PALSU);
    expect(json).not.toContain("tok-RAHASIA-xyz");
  });
});

describe("aggregateVerdict tidak membocorkan kredensial", () => {
  it("output JSON tidak mengandung apiKey yang disisipkan di input", () => {
    const input = {
      ...masukanCocok(),
      apiKey: API_KEY_PALSU,
      p1: { status: "exact", text: "gpt-4o", claimedOther: false, apiKey: API_KEY_PALSU },
      p4: {
        ttftMs: 180,
        totalMs: 1600,
        chunkCount: 42,
        fake: false,
        headers: { authorization: `Bearer ${API_KEY_PALSU}` },
      },
    };
    const hasil = aggregateVerdict(input);
    expect(JSON.stringify(hasil)).not.toContain(API_KEY_PALSU);
  });

  it("helper tidak menyimpan/mengembalikan input mentah", () => {
    // distributionOf hanya mengembalikan hitungan, bukan input aslinya.
    const { distributionOf } = probe;
    const dist = distributionOf(["a", "b"]);
    expect(JSON.stringify(dist)).not.toContain(API_KEY_PALSU);
    expect(dist).toEqual({ a: 1, b: 1 });
  });
});

describe("loadReferenceFingerprint", () => {
  it('menolak path traversal ("../evil") → null', async () => {
    expect(await loadReferenceFingerprint("../evil", "x")).toBeNull();
  });

  it('menolak traversal tersarang ("a/../../evil") → null', async () => {
    expect(await loadReferenceFingerprint("a/../../evil", "x")).toBeNull();
  });

  it('menolak absolute path ("/etc/passwd") → null', async () => {
    expect(await loadReferenceFingerprint("/etc/passwd", "x")).toBeNull();
  });

  it('("openai","gpt-4o") → null, atau objek placeholder (TIDAK dianggap referensi valid)', async () => {
    // Kontrak: null bila file tidak ada / placeholder:true.
    const hasil = await loadReferenceFingerprint("openai", "gpt-4o");
    expect(hasil === null || hasil.placeholder === true).toBe(true);
  });

  it("provider/model yang tidak ada → null", async () => {
    expect(
      await loadReferenceFingerprint("provider-contoh-tidak-ada", "model-contoh-tidak-ada")
    ).toBeNull();
  });
});
