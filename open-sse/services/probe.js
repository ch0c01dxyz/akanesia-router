/**
 * Probe LLM (ide #5c) — backend core sub-tab "Offline".
 *
 * Baterai fingerprinting lokal: 13 call ke endpoint provider, komputasi
 * statistik murni lokal (JSD basis-2 ala llm-fingerprint-detector, skor
 * ensemble n-gram ala whorl), lalu agregasi verdict match/uncertain/mismatch/
 * insufficient_data.
 *
 * KEAMANAN (aturan wajib repo — "JANGAN simpan secret/API key di log"):
 * - `credentials` hanya diteruskan ke executor, TIDAK PERNAH disalin ke report,
 *   evidence, warning, reason, atau log apa pun.
 * - Report hanya berisi metrik agregat + potongan teks jawaban (maks 600 char).
 */

import { getExecutor } from "../executors/index.js";
import { PROBE } from "../config/probe.js";

// -----------------------------------------------------------------------------
// Helper murni (di-export agar bisa di-test unit)
// -----------------------------------------------------------------------------

/**
 * Normalisasi jawaban satu-token: NFKC (sekaligus mengubah digit full-width
 * jadi ASCII), lowercase, trim, buang tanda baca trailing, kanonikalisasi warna
 * (grey → gray, dst.).
 */
export function normalizeAnswer(text) {
  if (text == null) return "";
  let s = String(text).normalize("NFKC").toLowerCase().trim();
  // Buang tanda baca / whitespace di akhir jawaban.
  s = s.replace(/[.,;:!?"'`()[\]{}…—–-]+$/u, "").trim();
  const canon = PROBE.offline.normalization.colorCanon[s];
  return canon ?? s;
}

/** Ubah objek {kunci: count|prob} atau array counts jadi distribusi probabilitas. */
function toProbabilityMap(input) {
  const entries = Array.isArray(input)
    ? input.map((count, i) => [String(i), count])
    : Object.entries(input);
  const total = entries.reduce((acc, [, v]) => acc + (Number(v) || 0), 0);
  const out = {};
  if (total <= 0) return out;
  for (const [k, v] of entries) {
    const n = Number(v) || 0;
    if (n > 0) out[k] = n / total;
  }
  return out;
}

/**
 * Jensen-Shannon divergence basis-2 (satuan bit), rentang 0–1.
 * Input: objek {jawaban: count|probabilitas} atau array counts.
 * Probabilitas nol ditangani dengan melewati suku KL yang nol (batas kontinu),
 * bukan dengan epsilon aditif — epsilon config hanya untuk guard numerik.
 */
export function jsdBase2(p, q) {
  const P = toProbabilityMap(p);
  const Q = toProbabilityMap(q);
  const keys = new Set([...Object.keys(P), ...Object.keys(Q)]);
  if (keys.size === 0) return 0;
  const eps = PROBE.verdict.ngram.epsilon;
  let jsd = 0;
  for (const k of keys) {
    const pk = P[k] ?? 0;
    const qk = Q[k] ?? 0;
    const m = (pk + qk) / 2;
    if (m <= 0) continue;
    if (pk > 0) jsd += 0.5 * pk * Math.log2(pk / (m + eps));
    if (qk > 0) jsd += 0.5 * qk * Math.log2(qk / (m + eps));
  }
  return Math.min(1, Math.max(0, jsd));
}

/** Array jawaban (mentah) → {jawabanTernormalisasi: count}. Jawaban kosong diabaikan. */
export function distributionOf(answers) {
  const dist = {};
  for (const a of answers ?? []) {
    const n = normalizeAnswer(a);
    if (!n) continue;
    dist[n] = (dist[n] ?? 0) + 1;
  }
  return dist;
}

/** JSD distribusi sampel (array jawaban mentah) vs counts referensi. */
export function jsdVsReference(samples, refCounts) {
  return jsdBase2(distributionOf(samples), refCounts ?? {});
}

/**
 * Bagi sampel jadi dua paruh (paruh pertama = floor(n/2)), hitung JSD antar paruh.
 * Split-half JSD tinggi = indikasi agregator merotasi backend antar request.
 * <2 sampel per paruh → 0 (tidak cukup data untuk menyimpulkan).
 */
export function splitHalfJsd(samples) {
  const arr = (samples ?? []).filter((s) => normalizeAnswer(s) !== "");
  const half = Math.floor(arr.length / 2);
  if (half < 1 || arr.length - half < 1) return 0;
  return jsdBase2(distributionOf(arr.slice(0, half)), distributionOf(arr.slice(half)));
}

/**
 * Profil n-gram karakter password: counts n-gram order 1–3 + distribusi
 * karakter posisi-0 (fitur ala whorl) + jumlah password valid.
 * Bentuk: { orders: {1: {...}, 2: {...}, 3: {...}}, pos0: {...}, count: n }.
 * Satu panggilan menghitung ketiga order sekaligus.
 */
export function ngramProfile(passwords) {
  const orders = PROBE.verdict.ngram.orders;
  const profile = { orders: {}, pos0: {}, count: 0 };
  for (const o of orders) profile.orders[o] = {};
  for (const raw of passwords ?? []) {
    const pw = String(raw ?? "");
    if (!pw) continue;
    profile.count += 1;
    const first = pw[0];
    profile.pos0[first] = (profile.pos0[first] ?? 0) + 1;
    for (const o of orders) {
      for (let i = 0; i + o <= pw.length; i++) {
        const gram = pw.slice(i, i + o);
        profile.orders[o][gram] = (profile.orders[o][gram] ?? 0) + 1;
      }
    }
  }
  return profile;
}

/** Cosine similarity dua map counts (0 bila salah satu vektor kosong). */
function cosineSimilarity(a, b) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  if (keys.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const va = a?.[k] ?? 0;
    const vb = b?.[k] ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Skor ensemble n-gram (0–1) password sampel vs profil referensi.
 *
 * Kontrak refProfile: { orders: {1: {...}, 2: {...}, 3: {...}}, pos0: {...} }
 * (hasil ngramProfile atas password referensi). Bentuk flat {1,2,3} juga
 * diterima sebagai toleransi. Tanpa orders yang valid → 0 (bukan NaN/throw).
 *
 * Rumus (terdokumentasi): untuk tiap order o ∈ {1,2,3}, sim_o = cosine antara
 * distribusi n-gram sampel dan referensi, bobot w_o = o/6 (lihat
 * PROBE.verdict.ngram.orderWeights). Komponen unigram digabung dengan
 * distribusi posisi-0 yang berbobot 3× (ala whorl):
 *   sim_1 = (simUni + 3·simPos0) / 4;  skor = Σ_o w_o · sim_o.
 * Skor bersifat relatif (bukan absolut): yang se-distribusi harus menang jelas.
 */
export function ngramEnsembleScore(passwords, refProfile) {
  if (!refProfile || typeof refProfile !== "object") return 0;
  const cfg = PROBE.verdict.ngram;
  const refOrders = refProfile.orders ?? refProfile;
  if (!refOrders || typeof refOrders !== "object") return 0;
  const sample = ngramProfile(passwords);
  const refPos0 = refProfile.pos0 ?? {};
  let score = 0;
  let used = false;
  cfg.orders.forEach((o, idx) => {
    const refMap = refOrders[o] ?? refOrders[String(o)];
    if (!refMap) return;
    used = true;
    const w = cfg.orderWeights[idx] ?? 0;
    let sim = cosineSimilarity(sample.orders[o], refMap);
    if (o === 1) {
      const simPos0 = cosineSimilarity(sample.pos0, refPos0);
      sim = (sim + cfg.pos0Weight * simPos0) / (1 + cfg.pos0Weight);
    }
    score += w * sim;
  });
  if (!used) return 0;
  return Math.min(1, Math.max(0, score));
}

// -----------------------------------------------------------------------------
// Agregasi verdict
// -----------------------------------------------------------------------------

/**
 * Agregasi verdict dari hasil probe (aturan dari spesifikasi ide #5c).
 *
 * Rumus confidence (0–1, deterministik):
 * - dasar = 0.50
 * - match:        +0.20 (P6 match) +0.15 (P5 konsisten) +0.10 (P1 exact);
 *                 −0.10 bila tanpa referensi
 * - mismatch:     dasar 0.55; +0.15 bila P6 DAN P5 mismatch (konfirmasi ganda),
 *                 +0.10 bila P1 claims-other model dikenal
 * - uncertain:    dasar 0.45; −0.05 bila tanpa referensi
 * - insufficient_data: 0.15 + 0.10 × (minValidSamples / 2), maks 0.35
 * Semua hasil di-clamp ke 0.95 dan dibulatkan 2 desimal.
 *
 * Flags terpisah dari verdict identitas (selalu boolean eksplisit):
 * - billing_anomaly   (P3: token padding)
 * - transport_anomaly (P4: fake streaming)
 * - backend_rotation  (split-half JSD tinggi; ambang di PROBE.verdict.splitHalfJsd)
 *
 * Rasio refusal: bila input tidak menyertakan `refusalRatio` eksplisit (seperti
 * dari orkestrasi yang menghitung atas 13 call), diturunkan dari status tiap
 * probe — jumlah probe berstatus "refusal" dibagi jumlah probe yang melaporkan
 * status (praktisnya p1/p2).
 */
export function aggregateVerdict(input) {
  const v = PROBE.verdict;
  const c = v.confidence;
  const reasons = [];
  const flags = { billing_anomaly: false, transport_anomaly: false, backend_rotation: false };

  const p1 = input?.p1 ?? {};
  const p2 = input?.p2 ?? {};
  const p3 = input?.p3 ?? {};
  const p4 = input?.p4 ?? {};
  const p5 = input?.p5 ?? {};
  const p6 = input?.p6 ?? {};
  const protocolMismatch = input?.protocolMismatch === true;
  // Rasio refusal: pakai angka eksplisit bila ada (dari orkestrasi, atas 13 call);
  // bila tidak, turunkan dari status tiap probe.
  let refusalRatio = input?.refusalRatio;
  if (typeof refusalRatio !== "number" || Number.isNaN(refusalRatio)) {
    const withStatus = [p1, p2, p3, p4, p5, p6].filter((pr) => typeof pr?.status === "string");
    const refusals = withStatus.filter((pr) => pr.status === "refusal").length;
    refusalRatio = withStatus.length ? refusals / withStatus.length : 0;
  }
  const failedCalls = input?.failedCalls ?? 0;
  const hasReference = input?.hasReference !== false;

  const minValid = p6.minValidSamples ?? 0;
  const p6verdict = p6.verdict ?? "uncertain";
  const p5consistent = p5.consistent === true;
  const p5mismatch = p5.consistent === false && hasReference;
  const p1ClaimsOther = p1.status === "claims-other";

  // Flag dimensi terpisah (bukan identitas).
  if (p3.anomaly === true) {
    flags.billing_anomaly = true;
    reasons.push(
      `P3: anomali token (charsPerToken=${fmt(p3.charsPerToken)} < ${v.p3CharsPerTokenMin} ` +
      `atau usageRatio=${fmt(p3.usageRatio)} > ${v.p3UsageRatioMax})`
    );
  }
  if (p4.fake === true) {
    flags.transport_anomaly = true;
    reasons.push(`P4: streaming terindikasi palsu (TTFT/total ≥ ${v.p4FakeTtftRatio})`);
  }
  // backend_rotation: split-half JSD tertinggi antar cell vs ambang.
  let maxSplitHalf = 0;
  for (const cell of Object.values(p6.cells ?? {})) {
    if (typeof cell?.splitHalfJsd === "number") maxSplitHalf = Math.max(maxSplitHalf, cell.splitHalfJsd);
  }
  const refSplitHalf = input?.referenceSplitHalfJsd;
  const rotationThreshold =
    typeof refSplitHalf === "number" ? refSplitHalf * v.splitHalfJsd.factor : v.splitHalfJsd.absoluteHigh;
  if (maxSplitHalf > rotationThreshold) {
    flags.backend_rotation = true;
    reasons.push(
      `Split-half JSD tinggi (${fmt(maxSplitHalf)} > ambang ${fmt(rotationThreshold)}) — ` +
      `indikasi agregator merotasi backend`
    );
  }

  const out = (verdict, confidence) => ({
    verdict,
    confidence: Math.round(Math.min(c.cap, Math.max(0, confidence)) * 100) / 100,
    flags,
    reasons
  });

  // 1) insufficient_data — didahulukan: tanpa data cukup, verdict lain tidak sah.
  if (minValid < v.minValidSamplesPerCell) {
    reasons.push(`Sampel valid per cell P6 hanya ${minValid} (< ${v.minValidSamplesPerCell})`);
    return out("insufficient_data", c.insufficientBase + 0.1 * Math.min(1, minValid / 2));
  }
  if (refusalRatio > v.maxRefusalRatio) {
    reasons.push(`Rasio refusal ${(refusalRatio * 100).toFixed(0)}% melebihi ${(v.maxRefusalRatio * 100).toFixed(0)}%`);
    return out("insufficient_data", c.insufficientBase);
  }
  if (failedCalls > 0) {
    reasons.push(`${failedCalls} call gagal — hasil tidak lengkap`);
    return out("insufficient_data", c.insufficientBase);
  }

  // 2) mismatch: (P6 mismatch DAN P5 mismatch) ATAU (P6 mismatch DAN P1 claims-other).
  if (p6verdict === "mismatch" && (p5mismatch || p1ClaimsOther)) {
    if (p5mismatch) reasons.push("P6 mismatch (JSD) dan P5 mismatch (n-gram password)");
    if (p1ClaimsOther) reasons.push(`P1 mengklaim model lain yang dikenal (${p1.claimedOther ?? "?"})`);
    let conf = 0.55;
    if (p5mismatch && p6verdict === "mismatch") conf += c.mismatchDoubleConfirm;
    if (p1ClaimsOther) conf += c.mismatchP1ClaimsOther;
    return out("mismatch", conf);
  }

  // 3) uncertain: P6 uncertain, probe bertentangan, atau protocolMismatch.
  const contradictory =
    (p6verdict === "match" && p5mismatch) ||
    (p6verdict === "mismatch" && p5consistent) ||
    (p6verdict === "match" && p1ClaimsOther);
  if (p6verdict === "uncertain" || contradictory || protocolMismatch) {
    if (p6verdict === "uncertain") reasons.push("P6 uncertain (JSD di zona abu-abu)");
    if (contradictory) reasons.push("Probe saling bertentangan (P5/P6/P1 tidak searah)");
    if (protocolMismatch) reasons.push("protocolMismatch: system prompt/temperatur referensi ≠ endpoint uji");
    if (!hasReference) reasons.push("Tanpa fingerprint referensi — P6 tidak bisa diputuskan");
    let conf = c.uncertainBase;
    if (!hasReference) conf -= c.noReferencePenalty / 2;
    return out("uncertain", conf);
  }

  // 4) match: P6 match DAN P5 konsisten DAN tanpa anomali transport.
  if (p6verdict === "match" && p5consistent && p4.fake !== true) {
    reasons.push("P6 match (JSD rendah), P5 konsisten, tanpa anomali transport");
    if (p1.status === "exact") reasons.push("P1 exact: model mengaku sesuai klaim");
    if (p2.status === "match") reasons.push("P2 match: cutoff sesuai model yang diklaim");
    let conf = c.base + c.matchP6 + c.matchP5;
    if (p1.status === "exact") conf += c.matchP1Exact;
    if (!hasReference) conf -= c.noReferencePenalty;
    return out("match", conf);
  }

  // Fallback: tidak masuk pola mana pun → uncertain (jujur, bukan match).
  reasons.push("Pola hasil tidak memenuhi syarat match/mismatch yang tegas");
  return out("uncertain", c.uncertainBase - c.noReferencePenalty / 2);
}

function fmt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(3) : "?";
}

// -----------------------------------------------------------------------------
// Loader fingerprint referensi
// -----------------------------------------------------------------------------

const SAFE_ID = /^[a-zA-Z0-9._-]+$/;

/**
 * Petakan ID arbitrer (mis. `deepseek-v4.1-flash:free`) ke nama file yang aman:
 * setiap rangkaian karakter di luar [a-zA-Z0-9._-] diganti satu "-".
 * Hasilnya selalu lolos SAFE_ID sehingga path traversal mustahil; lapisan
 * kedua (startsWith root) tetap dipertahankan di bawah.
 */
function keNamaFileAman(id) {
  const s = String(id ?? "").trim();
  if (!s) return "";
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Muat fingerprint referensi dari open-sse/config/probe/fingerprints/<providerId>/<modelId>.json.
 * - Sanitasi: providerId/modelId dipetakan via keNamaFileAman() (mis. ":" jadi "-",
 *   sehingga `deepseek-v4.1-flash:free` memakai file `deepseek-v4.1-flash-free.json`);
 *   hasil kosong/unsafe → return null. Path traversal mustahil karena output
 *   selalu dalam [a-zA-Z0-9._-] + pengecekan startsWith(root) lapis kedua.
 * - File tidak ada ATAU berisi "placeholder": true → return null (bukan error),
 *   artinya "tanpa referensi" (verdict P6 jadi uncertain, bukan gagal).
 */
export async function loadReferenceFingerprint(providerId, modelId) {
  const p = keNamaFileAman(providerId);
  const m = keNamaFileAman(modelId);
  if (!p || !m || !SAFE_ID.test(p) || !SAFE_ID.test(m)) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.join(here, "..", "config", "probe", "fingerprints");
    const file = path.join(root, p, `${m}.json`);
    // Pertahanan lapis kedua: pastikan path akhir tetap di dalam folder fingerprints.
    if (!file.startsWith(root + path.sep)) return null;
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw);
    if (!data || data.placeholder === true) return null;
    return data;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Orkestrasi run offline
// -----------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeProgress(onProgress, done, total) {
  if (typeof onProgress !== "function") return;
  try {
    onProgress(done, total);
  } catch {
    // Callback progress tidak boleh menggagalkan run.
  }
}

/** Ekstrak teks + usage dari body JSON chat-completions (best-effort). */
function parseChatJson(text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return { text: String(text ?? ""), usage: null };
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? "";
  const usage = data?.usage ?? null;
  return { text: Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : String(content ?? ""), usage };
}

function isRefusal(text) {
  const n = normalizeAnswer(text);
  return PROBE.offline.detection.refusalPatterns.some((pat) => n.includes(pat));
}

function truncate(text, max = PROBE.offline.detection.maxEvidenceChars) {
  const s = String(text ?? "");
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Satu call HTTP ke executor provider.
 * Mengembalikan metrik; TIDAK PERNAH melempar — error dicatat di metrik.status.
 * `credentials` hanya diteruskan ke executor, tidak disimpan di mana pun.
 */
async function singleCall({ providerId, modelId, credentials, body, stream }) {
  const timeoutMs = PROBE.offline.perCallTimeoutMs;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const metric = {
    status: "error",
    text: "",
    ttftMs: null,
    latencyMs: null,
    tokens: { prompt: null, completion: null },
    estimatedTokens: false,
    error: null
  };
  try {
    // getExecutor() kini async (lazy-load ide #1): resolve dulu sebelum .execute().
    const executor = await getExecutor(providerId);
    const result = await executor.execute({
      model: modelId,
      body,
      stream,
      credentials,
      signal: ctrl.signal,
      proxyOptions: {}
    });
    const response = result?.response;
    if (!response) throw new Error("executor tidak mengembalikan response");
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${truncate(errText, 200)}`);
    }

    if (stream) {
      // P4: ukur TTFT (chunk "data:" pertama berisi konten), hitung chunk, akumulasi teks.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      let chunkCount = 0;
      let ttftMs = null;
      let usage = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let evt = null;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (ttftMs === null) ttftMs = Date.now() - t0;
          const delta = evt?.choices?.[0]?.delta?.content ?? evt?.choices?.[0]?.text ?? "";
          if (delta) {
            chunkCount += 1;
            text += delta;
          }
          if (evt?.usage) usage = evt.usage;
        }
      }
      metric.ttftMs = ttftMs;
      metric.text = text;
      metric.tokens.prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
      metric.tokens.completion = usage?.completion_tokens ?? usage?.output_tokens ?? null;
      metric.chunkCount = chunkCount;
    } else {
      const raw = await response.text();
      const { text, usage } = parseChatJson(raw);
      metric.ttftMs = Date.now() - t0; // non-stream: aproksimasi, byte pertama ≈ seluruh body
      metric.text = text;
      metric.tokens.prompt = usage?.prompt_tokens ?? usage?.input_tokens ?? null;
      metric.tokens.completion = usage?.completion_tokens ?? usage?.output_tokens ?? null;
    }

    metric.latencyMs = Date.now() - t0;
    // Fallback estimasi lokal bila upstream tidak melaporkan usage.
    if (metric.tokens.completion == null) {
      metric.tokens.completion = Math.round(metric.text.length / PROBE.offline.detection.localTokenCharsPerToken);
      metric.estimatedTokens = true;
    }
    metric.status = isRefusal(metric.text) ? "refusal" : "ok";
    return metric;
  } catch (err) {
    metric.latencyMs = Date.now() - t0;
    metric.error = err?.name === "AbortError" ? `timeout ${timeoutMs}ms` : String(err?.message ?? err);
    return metric;
  } finally {
    clearTimeout(timer);
  }
}

/** Klasifikasi P1 dari teks jawaban (dipanggil hanya bila call sukses). */
function classifyP1(metric, modelId, reference) {
  if (metric.status === "refusal") return { status: "refusal", text: metric.text, claimedOther: null };
  if (metric.status !== "ok") return { status: "error", text: metric.text, claimedOther: null };
  const norm = normalizeAnswer(metric.text);
  const claimedNorm = normalizeAnswer(modelId);
  if (norm && claimedNorm && norm.includes(claimedNorm)) {
    return { status: "exact", text: metric.text, claimedOther: null };
  }
  const refModel = reference?.identity?.model;
  if (refModel && norm.includes(normalizeAnswer(refModel))) {
    return { status: "exact", text: metric.text, claimedOther: null };
  }
  const keywords = PROBE.offline.detection.knownModelKeywords;
  const hit = keywords.find((kw) => norm.includes(kw) && !(claimedNorm && claimedNorm.includes(kw)));
  if (hit) return { status: "claims-other", text: metric.text, claimedOther: hit };
  if (norm) return { status: "partial", text: metric.text, claimedOther: null };
  return { status: "error", text: metric.text, claimedOther: null };
}

/** Klasifikasi P2: cocok vs cutoff model yang diklaim (dari fingerprint referensi). */
function classifyP2(metric, reference) {
  if (metric.status === "refusal") return { status: "refusal", text: metric.text };
  if (metric.status !== "ok") return { status: "error", text: metric.text };
  const text = metric.text;
  const cutoff = reference?.cutoff;
  const pattern = new RegExp(PROBE.offline.detection.cutoffDatePattern);
  if (cutoff && normalizeAnswer(text).includes(normalizeAnswer(String(cutoff)))) {
    return { status: "match", text };
  }
  // Tanpa referensi: terima bila jawaban berupa tanggal yang valid (bukti lemah).
  if (!cutoff && pattern.test(text)) return { status: "match", text };
  return { status: "mismatch", text };
}

/**
 * Jalankan baterai offline penuh (13 call, sekuensial).
 *
 * @param {object} args
 * @param {string} args.providerId  - id provider (untuk getExecutor)
 * @param {string} args.modelId     - model yang diklaim/diuji
 * @param {object} args.credentials - kredensial koneksi; hanya diteruskan ke executor,
 *                                    TIDAK PERNAH masuk ke report
 * @param {object|null} args.reference - hasil loadReferenceFingerprint (null = tanpa referensi)
 * @param {function} args.onProgress - (done, total) => void; error di dalamnya diabaikan
 * @returns {object} report (tanpa credentials/apiKey/token/header auth dalam bentuk apa pun)
 */
export async function runOfflineProbe({ providerId, modelId, credentials, reference = null, onProgress }) {
  const t0 = Date.now();
  const probes = PROBE.offline.probes;
  const total = PROBE.offline.totalCalls;
  let done = 0;

  const chatBody = ({ system, user, temperature, maxTokens, stream }) => {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
    const body = { model: modelId, messages, temperature, stream: !!stream };
    if (maxTokens != null) body.max_tokens = maxTokens;
    return body;
  };

  // Susun 13 call sesuai tabel spesifikasi.
  const calls = [];
  calls.push({ probe: "p1", body: chatBody({ user: probes.p1.prompt, temperature: probes.p1.temperature, maxTokens: probes.p1.maxTokens }) });
  calls.push({ probe: "p2", body: chatBody({ user: probes.p2.prompt, temperature: probes.p2.temperature, maxTokens: probes.p2.maxTokens }) });
  calls.push({ probe: "p3", body: chatBody({ user: probes.p3.prompt, temperature: probes.p3.temperature }) });
  calls.push({ probe: "p4", body: chatBody({ user: probes.p4.prompt, temperature: probes.p4.temperature, stream: true }), stream: true });
  for (let i = 0; i < probes.p5.calls; i++) {
    calls.push({ probe: "p5", body: chatBody({ user: probes.p5.prompt, temperature: probes.p5.temperature }) });
  }
  for (const cell of probes.p6.cells) {
    for (let s = 0; s < probes.p6.samplesPerCell; s++) {
      calls.push({
        probe: "p6",
        cellId: cell.id,
        body: chatBody({
          system: probes.p6.systemPrompt,
          user: cell.prompts[s % cell.prompts.length],
          temperature: probes.p6.temperature,
          maxTokens: probes.p6.maxTokens
        })
      });
    }
  }

  // Eksekusi sekuensial (≤ maxConcurrency). Satu call gagal → catat, lanjut.
  const results = [];
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const metric = await singleCall({
      providerId,
      modelId,
      credentials,
      body: call.body,
      stream: call.stream === true
    });
    results.push({ ...call, metric });
    done += 1;
    safeProgress(onProgress, done, total);
    if (i < calls.length - 1) await sleep(PROBE.offline.delayBetweenCallsMs);
  }

  const byProbe = (id) => results.filter((r) => r.probe === id).map((r) => r.metric);
  const failedCalls = results.filter((r) => r.metric.status === "error").length;
  const refusalCount = results.filter((r) => r.metric.status === "refusal").length;
  const refusalRatio = results.length ? refusalCount / results.length : 0;

  // ---- P1 ----
  const p1Metric = byProbe("p1")[0];
  const p1 = classifyP1(p1Metric, modelId, reference);

  // ---- P2 ----
  const p2Metric = byProbe("p2")[0];
  const p2 = classifyP2(p2Metric, reference);

  // ---- P3 ----
  const p3Metric = byProbe("p3")[0];
  const p3charsPerToken =
    p3Metric.tokens.completion > 0 ? p3Metric.text.length / p3Metric.tokens.completion : null;
  const p3estimated = Math.max(1, Math.round(p3Metric.text.length / PROBE.offline.detection.localTokenCharsPerToken));
  const p3usageRatio = p3Metric.tokens.completion > 0 ? p3Metric.tokens.completion / p3estimated : null;
  const p3 = {
    charsPerToken: p3charsPerToken,
    usageRatio: p3usageRatio,
    estimated: p3Metric.estimatedTokens,
    anomaly:
      p3Metric.status === "ok" &&
      ((p3charsPerToken != null && p3charsPerToken < PROBE.verdict.p3CharsPerTokenMin) ||
        (p3usageRatio != null && p3usageRatio > PROBE.verdict.p3UsageRatioMax))
  };

  // ---- P4 ----
  const p4Metric = byProbe("p4")[0];
  const p4 = {
    ttftMs: p4Metric.ttftMs,
    totalMs: p4Metric.latencyMs,
    chunkCount: p4Metric.chunkCount ?? 0,
    fake:
      p4Metric.status === "ok" &&
      p4Metric.ttftMs != null &&
      p4Metric.latencyMs > 0 &&
      p4Metric.ttftMs / p4Metric.latencyMs >= PROBE.verdict.p4FakeTtftRatio
  };

  // ---- P5 ----
  const p5Metrics = byProbe("p5");
  const passwords = p5Metrics.filter((m) => m.status === "ok").map((m) => m.text.trim());
  const p5Score = reference?.passwordProfile ? ngramEnsembleScore(passwords, reference.passwordProfile) : null;
  const p5 = {
    scoreVsRef: p5Score,
    rankOfClaimed: reference?.passwordProfile ? 1 : null,
    consistent:
      reference?.passwordProfile
        ? p5Score != null && p5Score >= PROBE.verdict.p5ConsistentScoreMin && passwords.length === probes.p5.calls
        : false
  };

  // ---- P6 ----
  const p6Cells = {};
  let minValidSamples = Infinity;
  let meanJsdSum = 0;
  let meanJsdCount = 0;
  for (const cell of probes.p6.cells) {
    const samples = results
      .filter((r) => r.probe === "p6" && r.cellId === cell.id)
      .map((r) => r.metric.text);
    const validSamples = samples.filter((s) => normalizeAnswer(s) !== "").length;
    minValidSamples = Math.min(minValidSamples, validSamples);
    const refCounts = reference?.cells?.[cell.id]?.counts ?? null;
    const jsd = refCounts ? jsdVsReference(samples, refCounts) : null;
    const cellSplitHalf = splitHalfJsd(samples);
    let cellVerdict = "uncertain";
    if (jsd != null) {
      cellVerdict =
        jsd <= PROBE.verdict.jsd.matchMax
          ? "match"
          : jsd <= PROBE.verdict.jsd.uncertainMax
            ? "uncertain"
            : "mismatch";
      meanJsdSum += jsd;
      meanJsdCount += 1;
    }
    p6Cells[cell.id] = { jsd, samples: validSamples, splitHalfJsd: cellSplitHalf, verdict: cellVerdict };
  }
  if (minValidSamples === Infinity) minValidSamples = 0;
  const cellVerdicts = Object.values(p6Cells).map((c) => c.verdict);
  const p6verdict = cellVerdicts.includes("mismatch")
    ? "mismatch"
    : cellVerdicts.includes("uncertain")
      ? "uncertain"
      : "match";
  const p6 = {
    cells: p6Cells,
    meanJsd: meanJsdCount ? meanJsdSum / meanJsdCount : null,
    verdict: p6verdict,
    minValidSamples
  };

  // ---- protocolMismatch ----
  const protocolMismatch =
    reference?.protocol != null &&
    (reference.protocol.systemPrompt !== probes.p6.systemPrompt ||
      Number(reference.protocol.temperature) !== Number(probes.p6.temperature));

  // ---- Agregasi ----
  const agg = aggregateVerdict({
    p1,
    p2,
    p3,
    p4,
    p5,
    p6,
    protocolMismatch,
    refusalRatio,
    failedCalls,
    hasReference: reference != null,
    referenceSplitHalfJsd: reference?.splitHalfJsd ?? null
  });

  // ---- Report ----
  const groupStatus = {
    p1:
      p1.status === "exact"
        ? "pass"
        : p1.status === "partial"
          ? "warn"
          : p1.status === "claims-other"
            ? "fail"
            : "skip",
    p2: p2.status === "match" ? "pass" : p2.status === "mismatch" ? "warn" : "skip",
    p3: p3Metric.status !== "ok" ? "skip" : p3.anomaly ? "warn" : "pass",
    p4: p4Metric.status !== "ok" ? "skip" : p4.fake ? "warn" : "pass",
    p5:
      p5Metrics.some((m) => m.status === "error")
        ? "skip"
        : reference?.passwordProfile
          ? p5.consistent
            ? "pass"
            : "warn"
          : "skip",
    p6: p6verdict === "match" ? "pass" : p6verdict === "uncertain" ? "warn" : p6verdict === "mismatch" ? "fail" : "skip"
  };

  const groups = [
    { id: "p1", label: "P1 · Model identity", status: groupStatus.p1, detail: p1StatusDetail(p1) },
    { id: "p2", label: "P2 · Knowledge cutoff", status: groupStatus.p2, detail: p2StatusDetail(p2) },
    {
      id: "p3",
      label: "P3 · Token check",
      status: groupStatus.p3,
      detail:
        p3Metric.status !== "ok"
          ? "Call failed/refused."
          : `charsPerToken=${fmt(p3.charsPerToken)}, usageRatio=${fmt(p3.usageRatio)}${p3.estimated ? " (local estimate)" : ""}`
    },
    {
      id: "p4",
      label: "P4 · Fake streaming",
      status: groupStatus.p4,
      detail:
        p4Metric.status !== "ok"
          ? "Call failed/refused."
          : `TTFT=${p4.ttftMs}ms / total=${p4.totalMs}ms, ${p4.chunkCount} chunk`
    },
    {
      id: "p5",
      label: "P5 · Password (n-gram)",
      status: groupStatus.p5,
      detail:
        p5.scoreVsRef == null
          ? "No reference password profile."
          : `skor ensemble=${p5.scoreVsRef.toFixed(3)} ${p5.consistent ? "(consistent)" : "(inconsistent)"}`
    },
    {
      id: "p6",
      label: "P6 · One-token battery (JSD)",
      status: groupStatus.p6,
      detail:
        p6.meanJsd == null
          ? "No reference fingerprint."
          : `mean JSD=${p6.meanJsd.toFixed(3)}, verdict=${p6verdict}, sampel valid min=${p6.minValidSamples}`
    }
  ];

  const warnings = [];
  if (agg.flags.billing_anomaly) {
    warnings.push({ severity: "warn", label: "billing_anomaly", detail: "P3 indicates token padding by upstream." });
  }
  if (agg.flags.transport_anomaly) {
    warnings.push({ severity: "warn", label: "transport_anomaly", detail: "P4 indicates fake streaming (entire output sent at once)." });
  }
  if (agg.flags.backend_rotation) {
    warnings.push({ severity: "warn", label: "backend_rotation", detail: "High split-half JSD — aggregator likely rotating backends." });
  }
  if (protocolMismatch) {
    warnings.push({ severity: "warn", label: "protocol_mismatch", detail: "Reference protocol (system prompt/temperature) differs from the test endpoint — verdict capped at uncertain." });
  }
  if (reference == null) {
    warnings.push({ severity: "info", label: "tanpa_referensi", detail: "No reference fingerprint for this model yet — P5/P6 cannot be fully decided." });
  }
  if (failedCalls > 0) {
    warnings.push({ severity: "critical", label: "call_gagal", detail: `${failedCalls} of ${total} calls failed.` });
  }

  const totalIn = results.reduce((a, r) => a + (r.metric.tokens.prompt ?? 0), 0);
  const totalOut = results.reduce((a, r) => a + (r.metric.tokens.completion ?? 0), 0);
  const durationMs = Date.now() - t0;
  const ttfts = results.map((r) => r.metric.ttftMs).filter((t) => t != null);

  const predictedFamily = reference?.identity?.family ?? guessFamily(modelId);
  const predictedSubmodel = reference?.identity?.model ?? modelId;

  const conclusions = {
    match: `Model appears GENUINE (${predictedFamily}) — statistical fingerprint matches the reference.`,
    mismatch: `Model appears MASKED — statistical fingerprint does not match ${predictedFamily}.`,
    uncertain: `Result UNCERTAIN — more data or fingerprint calibration needed.`,
    insufficient_data: `INSUFFICIENT DATA for a verdict — check the connection and re-run the probe.`
  };

  // Report: TIDAK memuat credentials/apiKey/token/header auth dalam bentuk apa pun.
  return {
    verdict: agg.verdict,
    confidence: agg.confidence,
    summary: {
      claimedModel: modelId,
      predictedFamily,
      predictedFamilyConfidence: agg.verdict === "match" ? agg.confidence : agg.verdict === "mismatch" ? agg.confidence : 0.3,
      predictedSubmodel,
      predictedSubmodelConfidence: agg.verdict === "match" ? agg.confidence : 0.3,
      conclusion: conclusions[agg.verdict] ?? conclusions.uncertain
    },
    groups,
    metrics: {
      ttftMs: p4.ttftMs,
      tps: durationMs > 0 ? Math.round((totalOut / (durationMs / 1000)) * 10) / 10 : null,
      totalLatencyMs: durationMs,
      totalTokens: { input: totalIn, output: totalOut },
      avgTtftMs: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : null
    },
    warnings,
    flags: agg.flags,
    evidence: {
      p1Text: truncate(p1.text),
      p1Status: p1.status,
      p1ClaimedOther: p1.claimedOther,
      p2Text: truncate(p2.text),
      p2Status: p2.status,
      p3CharsPerToken: p3.charsPerToken,
      p3UsageRatio: p3.usageRatio,
      p4TtftMs: p4.ttftMs,
      p4TotalMs: p4.totalMs,
      p4ChunkCount: p4.chunkCount,
      p5ScoreVsRef: p5.scoreVsRef,
      p6MeanJsd: p6.meanJsd,
      p6Cells: Object.fromEntries(Object.entries(p6Cells).map(([id, c]) => [id, { jsd: c.jsd, samples: c.samples, splitHalfJsd: c.splitHalfJsd, verdict: c.verdict }])),
      reasons: agg.reasons
    },
    meta: {
      providerId,
      modelId,
      callsMade: results.length,
      callsTotal: total,
      durationMs,
      timestamp: new Date().toISOString(),
      hasReference: reference != null
    }
  };
}

/** Tebakan kasar family dari nama model (fallback bila tanpa referensi). */
function guessFamily(modelId) {
  const n = normalizeAnswer(modelId);
  const kw = PROBE.offline.detection.knownModelKeywords.find((k) => n.includes(k));
  return kw ?? "unknown";
}

function p1StatusDetail(p1) {
  switch (p1.status) {
    case "exact":
      return "Model claims a name matching the claimed model.";
    case "partial":
      return "Model answered the identity question but not exactly matching the claim (weak evidence).";
    case "claims-other":
      return `Model claims to be another known model: ${p1.claimedOther ?? "?"}.`;
    case "refusal":
      return "Model refused to answer the identity question.";
    default:
      return "Call failed — no answer.";
  }
}

function p2StatusDetail(p2) {
  switch (p2.status) {
    case "match":
      return "Cutoff matches the claimed model (or is a valid date).";
    case "mismatch":
      return "Cutoff does not match the claimed model.";
    case "refusal":
      return "Model refused to answer the cutoff question.";
    default:
      return "Call failed — no answer.";
  }
}
