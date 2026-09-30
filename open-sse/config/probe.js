// Konfigurasi baterai "Probe LLM" (ide #5c) — cek keaslian LLM suatu provider.
// Seluruh konstanta terpusat di sini; kode orkestrasi/helper dilarang meng-hardcode
// angka atau string ajaib di luar file ini (aturan config-driven repo).
// Bahasa komentar: Indonesia.

export const PROBE = {
  // ---------------------------------------------------------------------------
  // Sub-tab "Offline": baterai fingerprinting lokal, 13 call ke endpoint provider.
  // ---------------------------------------------------------------------------
  offline: {
    // Jumlah total call per run offline (P1:1 + P2:1 + P3:1 + P4:1 + P5:3 + P6:6).
    totalCalls: 13,
    // Batas waktu per call (AbortController). Melebihi ini → call dicatat gagal, run lanjut.
    perCallTimeoutMs: 15000,
    // Jeda antar call agar tidak membanjiri upstream dan menyerupai trafik manusiawi.
    delayBetweenCallsMs: 500,
    // Batas konkurensi orkestrasi. Implementasi saat ini sekuensial (= 1), jadi ≤ 2.
    maxConcurrency: 2,

    // Definisi probe P1–P6 sesuai tabel spesifikasi ide #5c.
    probes: {
      p1: {
        id: "p1",
        label: "Identitas model",
        calls: 1,
        prompt: "What model are you? Answer with your exact model name and provider only.",
        temperature: 0,
        maxTokens: 64
      },
      p2: {
        id: "p2",
        label: "Knowledge cutoff",
        calls: 1,
        prompt: "What is your knowledge cutoff date? Answer with the date only, e.g. 2024-10.",
        temperature: 0,
        maxTokens: 32
      },
      p3: {
        id: "p3",
        label: "Cek token",
        calls: 1,
        prompt: "Repeat the word 'blue' exactly 50 times, separated by single spaces. Output only the words.",
        temperature: 0
      },
      p4: {
        id: "p4",
        label: "Streaming palsu",
        calls: 1,
        prompt: "Write a ~200 word story about a lighthouse.",
        temperature: 0.7,
        stream: true
      },
      p5: {
        id: "p5",
        label: "Password",
        calls: 3,
        prompt:
          "Generate a random password 15 characters long. Do not use any tools. Respond with only the password and nothing else.",
        temperature: 1.0
      },
      p6: {
        id: "p6",
        label: "Baterai satu-token",
        // 2 cell teratas × 3 sampel = 6 call.
        samplesPerCell: 3,
        temperature: 1.0,
        maxTokens: 16,
        // System prompt WAJIB identik antara referensi dan endpoint uji — mengganti
        // system prompt saja bisa menggeser JSD ≈0.44–0.46 (temuan llm-fingerprint-detector).
        systemPrompt: "Answer with exactly one word. No punctuation, no explanation.",
        cells: [
          {
            id: "random-number-1-100:en",
            // Satu varian parafrase per sampel (dipilih berurutan per index sampel).
            prompts: [
              "Pick a random integer between 1 and 100.",
              "Choose a random number from 1 to 100.",
              "Name a random integer in the range 1 to 100."
            ]
          },
          {
            id: "random-color:en",
            prompts: [
              "Pick a random color.",
              "Choose a random color name.",
              "Name a random color."
            ]
          }
        ]
      }
    },

    // Konstanta deteksi & normalisasi jawaban.
    detection: {
      // Pola refusal (dicocokkan case-insensitive terhadap jawaban ternormalisasi).
      refusalPatterns: [
        "i'm sorry",
        "i am sorry",
        "i cannot",
        "i can't",
        "as an ai",
        "as a language model",
        "unable to",
        "i refuse",
        "not able to"
      ],
      // Kata kunci nama model/keluarga yang dikenal — dipakai P1 untuk mendeteksi
      // "claims-other" (model mengaku sebagai model lain yang dikenal).
      knownModelKeywords: [
        "gpt", "o1", "o3", "o4", "codex", "chatgpt",
        "claude", "opus", "sonnet", "haiku",
        "gemini", "palm", "bard",
        "llama", "mistral", "mixtral", "qwen", "deepseek",
        "grok", "kimi", "glm", "doubao", "minimax", "zhipu",
        "phi", "falcon", "yi", "command", "cohere", "copilot"
      ],
      // Panjang maksimum teks jawaban yang disimpan di evidence report.
      maxEvidenceChars: 600,
      // Estimasi token lokal bila upstream tidak melaporkan usage: len(teks)/4.
      localTokenCharsPerToken: 4,
      // Pola tanggal cutoff yang dianggap valid untuk P2 (mis. "2024-10", "2024").
      cutoffDatePattern: "\\b(19|20)\\d{2}(-(0[1-9]|1[0-2]))?\\b"
    },

    // Konstanta normalisasi jawaban (dipakai normalizeAnswer).
    normalization: {
      // Kanonikalisasi nama warna (grey → gray, dst.) agar varian ejaan tidak
      // dianggap jawaban berbeda oleh JSD.
      colorCanon: {
        grey: "gray",
        lightgrey: "light gray",
        darkgrey: "dark gray",
        grayish: "gray",
        greyish: "gray",
        lightgray: "light gray",
        darkgray: "dark gray"
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Agregasi verdict — ambang & bobot statistik.
  // ---------------------------------------------------------------------------
  verdict: {
    // Ambang JSD basis-2 (0–1 bit) untuk konfigurasi mini (2 cell × 3 sampel).
    // ⚠️ Nilai ini BELUM terkalibrasi empiris untuk mini-config — pita kalibrasi
    // literatur (8 cell × 25 sampel): match ≤ 0.25 < uncertain ≤ 0.35 < mismatch.
    // Wajib kalibrasi ulang setelah data referensi terkumpul (lihat README fingerprint).
    jsd: {
      matchMax: 0.25,
      uncertainMax: 0.35
    },
    // P3: curiga token padding bila charsPerToken < 3.2 atau usage > 1.3× estimasi lokal.
    p3CharsPerTokenMin: 3.2,
    p3UsageRatioMax: 1.3,
    // P4: streaming dianggap palsu bila TTFT/total ≥ 0.95.
    p4FakeTtftRatio: 0.95,
    // P5: skor ensemble n-gram vs profil referensi; konsisten bila ≥ ambang ini.
    // ⚠️ Ambang provisional, belum terkalibrasi empiris.
    p5ConsistentScoreMin: 0.75,
    // Flag backend_rotation: split-half JSD tinggi.
    // Ambang = splitHalfJsd referensi × factor bila referensi tersedia,
    // fallback ke absoluteHigh bila tidak ada referensi.
    splitHalfJsd: {
      factor: 1.5,
      absoluteHigh: 0.35
    },
    // Syarat data minimum untuk verdict yang sah.
    minValidSamplesPerCell: 2,
    maxRefusalRatio: 0.5,
    // Statistik n-gram P5 (ala whorl): bobot order uni/bi/tri = 1/2/3 (ternormalisasi),
    // distribusi karakter posisi-0 berbobot 3× di dalam komponen unigram.
    ngram: {
      orders: [1, 2, 3],
      orderWeights: [1 / 6, 2 / 6, 3 / 6],
      pos0Weight: 3,
      // Epsilon untuk menghindari log(0)/pembagian nol pada probabilitas nol.
      epsilon: 1e-12
    },
    // Bobot rumus confidence (terdokumentasi di aggregateVerdict).
    confidence: {
      base: 0.5,
      matchP6: 0.2,
      matchP5: 0.15,
      matchP1Exact: 0.1,
      mismatchDoubleConfirm: 0.15,
      mismatchP1ClaimsOther: 0.1,
      noReferencePenalty: 0.1,
      uncertainBase: 0.45,
      insufficientBase: 0.15,
      cap: 0.95
    }
  },

  // ---------------------------------------------------------------------------
  // Sub-tab "Online": via BazaarLink Probe API (tahap 2 — belum diimplementasi).
  // Konstanta disiapkan agar kontrak URL/rate-limit terpusat sejak awal.
  // ---------------------------------------------------------------------------
  online: {
    bazaarBaseUrl: "https://bazaarlink.ai",
    startPath: "/api/probe/run",
    // Path polling status run; runId di-encode agar aman di URL.
    runPath: (runId) => `/api/probe/run/${encodeURIComponent(runId)}`,
    // Interval polling status run async.
    pollIntervalMs: 7000,
    // Batas atas polling (run kedaluwarsa 30 menit di sisi BazaarLink).
    maxPollMs: 30 * 60 * 1000,
    // Rate limit resmi: 30 run/IP/jam → UI wajib countdown, tanpa auto-retry.
    rateLimitPerHour: 30
  }
};
