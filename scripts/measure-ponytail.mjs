// Pengukuran efektivitas Ponytail via A/B test.
//
// Menjalankan serangkaian prompt coding yang sama melalui gateway dengan
// Ponytail OFF vs tiap level (lite/full/ultra), lalu membandingkan
// completion_tokens (output) dan prompt_tokens (biaya injeksi prompt).
//
// Env:
//   GATEWAY_URL     default http://localhost:20128
//   GATEWAY_API_KEY wajib — API key gateway (sk_9router...)
//   MODEL           wajib — model yang diuji, mis. "openai/gpt-4o-mini"
//   RUNS            default 3 — repetisi per prompt per fase
//
// Settings ponytail diubah via PATCH /api/settings antar fase, lalu
// DIKEMBALIKAN ke nilai semula setelah selesai (try/finally).

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:20128";
const API_KEY = process.env.GATEWAY_API_KEY;
const MODEL = process.env.MODEL;
const RUNS = parseInt(process.env.RUNS || "3", 10);

if (!API_KEY) {
  console.error("GATEWAY_API_KEY wajib diisi.");
  process.exit(1);
}
if (!MODEL) {
  console.error("MODEL wajib diisi, mis. MODEL=openai/gpt-4o-mini");
  process.exit(1);
}

const PROMPTS = [
  "Write a JavaScript debounce function with a clear example of usage.",
  "Write a Python function that flattens an arbitrarily nested list.",
  "Write a SQL query to find duplicate emails in a users table.",
  "Write a bash command to list the 10 largest files under the current directory.",
  "Implement binary search in Go with a small main function demonstrating it.",
];

const PHASES = [
  { name: "off", ponytailEnabled: false, ponytailLevel: "full" },
  { name: "lite", ponytailEnabled: true, ponytailLevel: "lite" },
  { name: "full", ponytailEnabled: true, ponytailLevel: "full" },
  { name: "ultra", ponytailEnabled: true, ponytailLevel: "ultra" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options = {}) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function getPonytailSettings() {
  const s = await api("/api/settings");
  return { ponytailEnabled: s.ponytailEnabled, ponytailLevel: s.ponytailLevel };
}

async function setPonytail(enabled, level) {
  await api("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ ponytailEnabled: enabled, ponytailLevel: level }),
  });
}

async function runOnce(prompt) {
  const data = await api("/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      stream: false,
      max_tokens: 2048,
    }),
  });
  const usage = data.usage || {};
  return {
    promptTokens: usage.prompt_tokens || 0,
    completionTokens: usage.completion_tokens || 0,
  };
}

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { mean: Math.round(mean), median };
}

async function main() {
  const original = await getPonytailSettings();
  console.log(`Model: ${MODEL} | ${PROMPTS.length} prompt x ${RUNS} repetisi x ${PHASES.length} fase`);
  console.log(`Settings awal: enabled=${original.ponytailEnabled} level=${original.ponytailLevel}\n`);

  const results = {};
  try {
    for (const phase of PHASES) {
      await setPonytail(phase.ponytailEnabled, phase.ponytailLevel);
      await sleep(500); // beri waktu settings tersimpan
      const completions = [];
      const prompts = [];
      for (const prompt of PROMPTS) {
        for (let i = 0; i < RUNS; i++) {
          const r = await runOnce(prompt);
          completions.push(r.completionTokens);
          prompts.push(r.promptTokens);
          process.stdout.write(".");
          await sleep(1000);
        }
      }
      results[phase.name] = {
        completion: stats(completions),
        prompt: stats(prompts),
        samples: completions.length,
      };
      console.log(` ${phase.name} selesai\n`);
    }
  } finally {
    await setPonytail(original.ponytailEnabled, original.ponytailLevel);
    console.log(`\nSettings dikembalikan: enabled=${original.ponytailEnabled} level=${original.ponytailLevel}`);
  }

  const base = results.off.completion.mean;
  console.log("\n=== HASIL (completion_tokens = token output) ===");
  console.log("fase   | mean out | median out | mean in | hemat vs off");
  console.log("-------|----------|------------|---------|------------");
  for (const phase of PHASES) {
    const r = results[phase.name];
    const savedPct = phase.name === "off" ? "-" : `${(((base - r.completion.mean) / base) * 100).toFixed(1)}%`;
    console.log(
      `${phase.name.padEnd(6)} | ${String(r.completion.mean).padStart(8)} | ${String(r.completion.median).padStart(10)} | ${String(r.prompt.mean).padStart(7)} | ${savedPct}`
    );
  }
  console.log("\nCatatan: 'mean in' mencakup biaya injeksi system prompt Ponytail.");
  console.log("Hemat bersih = (out_off - out_fase) - (in_fase - in_off).");

  // Simpan hasil mentah terstruktur untuk analisis lanjutan.
  const fs = await import("fs");
  const outFile = "ponytail-ab-results.json";
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      { model: MODEL, runs: RUNS, prompts: PROMPTS, phases: results, at: new Date().toISOString() },
      null,
      2
    )
  );
  console.log(`\nHasil lengkap tersimpan di ${outFile} — upload file ini untuk analisis.`);
}

main().catch((e) => {
  console.error("\nGagal:", e.message);
  process.exit(1);
});
