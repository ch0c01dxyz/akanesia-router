// Ide #5c "Probe LLM" — unit test profil n-gram + skor ensemble (probe P5 password).
// Modul: open-sse/services/probe.js (implementasi worker backend).
// Bentuk nyata: ngramProfile(passwords) → { orders:{1,2,3}, pos0, count }
// (tanpa argumen order — SEMUA order 1–3 dihitung sekaligus, plus distribusi
// karakter posisi-0 ala whorl). ngramEnsembleScore(passwords, refProfile)
// memakai profil bentuk itu sebagai referensi (bentuk flat {1,2,3} juga
// ditoleransi); skor relatif, bukan absolut.
import { describe, it, expect } from "vitest";
import { ngramProfile, ngramEnsembleScore } from "open-sse/services/probe.js";

// Password acuan: berat ke huruf "a" (ada sisipan "b" deterministik).
const buatAcuan = (jumlah, offset = 0) =>
  Array.from({ length: jumlah }, (_, i) =>
    Array.from({ length: 12 }, (_, j) =>
      (i * 7 + j * 13 + offset) % 11 === 0 ? "b" : "a"
    ).join("")
  );

// Password uniform: sebaran merata atas 36 karakter.
const ALFABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const buatUniform = (jumlah) =>
  Array.from({ length: jumlah }, (_, i) =>
    Array.from({ length: 12 }, (_, j) => ALFABET[(i * 31 + j * 17) % ALFABET.length]).join("")
  );

describe("ngramProfile", () => {
  it('menghitung unigram: "abc" → orders[1] = {a:1,b:1,c:1}', () => {
    expect(ngramProfile(["abc"]).orders[1]).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('menghitung bigram: "abab" → orders[2] = {ab:2, ba:1}', () => {
    expect(ngramProfile(["abab"]).orders[2]).toEqual({ ab: 2, ba: 1 });
  });

  it('menghitung trigram: "abcd" → orders[3] = {abc:1, bcd:1}', () => {
    expect(ngramProfile(["abcd"]).orders[3]).toEqual({ abc: 1, bcd: 1 });
  });

  it("satu panggilan menghasilkan ketiga order sekaligus", () => {
    const profil = ngramProfile(["abc"]);
    expect(profil.orders[1]).toEqual({ a: 1, b: 1, c: 1 });
    expect(profil.orders[2]).toEqual({ ab: 1, bc: 1 });
    expect(profil.orders[3]).toEqual({ abc: 1 });
  });

  it("mengagregat lintas password + distribusi posisi-0", () => {
    const profil = ngramProfile(["ab", "ac"]);
    expect(profil.orders[1]).toEqual({ a: 2, b: 1, c: 1 });
    expect(profil.pos0).toEqual({ a: 2 });
    expect(profil.count).toBe(2);
  });

  it("input kosong → profil kosong (count 0)", () => {
    const profil = ngramProfile([]);
    expect(profil.count).toBe(0);
    expect(profil.orders[1]).toEqual({});
    expect(profil.pos0).toEqual({});
  });
});

describe("ngramEnsembleScore", () => {
  const profilAcuan = () => ngramProfile(buatAcuan(24));

  it("password dari distribusi yang sama dengan referensi → skor tinggi", () => {
    const refProfile = profilAcuan();
    const skorSama = ngramEnsembleScore(buatAcuan(8, 5), refProfile);
    const skorUniform = ngramEnsembleScore(buatUniform(8), refProfile);
    // Relatif, bukan absolut: yang se-distribusi harus menang jelas.
    expect(skorSama).toBeGreaterThan(skorUniform);
  });

  it("password acak uniform vs referensi berat → skor rendah", () => {
    const refProfile = profilAcuan();
    const skorSama = ngramEnsembleScore(buatAcuan(8, 5), refProfile);
    const skorUniform = ngramEnsembleScore(buatUniform(8), refProfile);
    expect(skorUniform).toBeLessThan(skorSama);
    expect(skorUniform).toBeGreaterThanOrEqual(0);
  });

  it("bentuk flat {1,2,3} ditoleransi (skor valid, urutan relatif terjaga)", () => {
    // Toleransi = diterima tanpa throw dan tetap diskriminatif (tanpa pos0
    // skornya wajar bila sedikit berbeda dari bentuk {orders, pos0} penuh).
    const ref = ngramProfile(buatAcuan(24));
    const skorSama = ngramEnsembleScore(buatAcuan(8, 5), ref.orders);
    const skorUniform = ngramEnsembleScore(buatUniform(8), ref.orders);
    expect(skorSama).toBeGreaterThanOrEqual(0);
    expect(skorSama).toBeLessThanOrEqual(1);
    expect(skorSama).toBeGreaterThan(skorUniform);
  });

  it("skor selalu dalam rentang 0–1", () => {
    const refProfile = profilAcuan();
    for (const pw of [buatAcuan(4, 1), buatUniform(4)]) {
      const skor = ngramEnsembleScore(pw, refProfile);
      expect(skor).toBeGreaterThanOrEqual(0);
      expect(skor).toBeLessThanOrEqual(1);
    }
  });

  it("refProfile tanpa orders → 0 (bukan NaN/throw)", () => {
    expect(ngramEnsembleScore(buatAcuan(4), null)).toBe(0);
    expect(ngramEnsembleScore(buatAcuan(4), {})).toBe(0);
  });

  it("deterministik: input sama → skor sama", () => {
    const refProfile = profilAcuan();
    const pw = buatAcuan(6, 3);
    expect(ngramEnsembleScore(pw, refProfile)).toBe(ngramEnsembleScore(pw, refProfile));
  });
});
