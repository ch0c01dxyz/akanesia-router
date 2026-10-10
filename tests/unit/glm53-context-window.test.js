import { describe, expect, it } from "vitest";

import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// #4544: GLM-5.3 mengiklankan konteks 200k. Pattern `*glm-5.3*` mem-pin
// contextWindow ke 200000 (warisan era pra-5.2 ketika seluruh lini z.ai 200k),
// dan pattern ini berada DI ATAS catch-all `*glm-5*` — jadi pattern inilah,
// bukan catch-all, yang dipakai setiap id 5.3.
//
// Context window bukan kosmetik: stripHistoryForContext() milik capacityAdapter
// memangkas riwayat percakapan pada 80% dari nilai ini, sehingga under-count 5x
// diam-diam membuang riwayat yang sebenarnya masih muat di model.

const caps = (id, provider = "zai") => getCapabilitiesForModel(provider, id);

describe("GLM 5.2/5.3 berkonteks 1M (#4544)", () => {
  it.each([
    "glm-5.3",
    "glm-5.3-flash",
    "glm-5.3-highspeed",
    "glm-5.3-prime",
  ])(
    "%s mengiklankan 1M, bukan pin 200k yang basi",
    (id) => {
      expect(caps(id).contextWindow).toBe(1000000);
    }
  );

  it("glm-5.2 juga 1M — pin basi yang sama berlaku padanya", () => {
    expect(caps("glm-5.2").contextWindow).toBe(1000000);
  });

  it("resolve sama untuk semua provider, bukan cuma zai", () => {
    for (const p of ["zai", "glm-cn"]) {
      expect(caps("glm-5.3", p).contextWindow, p).toBe(1000000);
    }
  });

  it.each(["glm-5.1", "glm-5-turbo", "glm-5v-turbo", "glm-5", "glm-5.0"])(
    "%s mempertahankan window ~200k aslinya",
    (id) => {
      // Penjaga agar tidak "memperbaiki" catch-all. models.dev mencatat
      // varian-varian ini di banyak reseller pada 163k-205k, jadi 200000
      // benar khusus untuk mereka.
      expect(caps(id).contextWindow).toBe(200000);
    }
  );

  it("tetap tidak meng-gate reasoning_effort untuk model pra-5.2", () => {
    // Komentar di atas blok pattern eksplisit soal ini: z.ai membaca
    // reasoning_effort hanya dari 5.2 ke atas, jadi 5.1/5-turbo tidak boleh mengklaimnya.
    for (const id of ["glm-5.1", "glm-5-turbo", "glm-5"]) {
      expect(caps(id).thinkingEffortSupported, id).toBeFalsy();
    }
  });
});
