// Pengukuran efektivitas Ponytail via A/B test.
//
// Menjalankan serangkaian prompt coding yang sama melalui gateway dengan
// Ponytail OFF vs tiap level (lite/full/ultra) memakai header per-request
// x-9router-ponytail — TANPA mengubah settings global (tidak butuh auth
// dashboard, tidak mengganggu traffic lain).
//
// Env (PowerShell):
//   $env:GATEWAY_URL="http://localhost:20127"   # default http://localhost:20128
//   $env:GATEWAY_API_KEY="sk_9router..."         # wajib
//   $env:MODEL="provider/model"                 # wajib, mis. bansosmontera/deepseek-v4.1-flash
//   $env:RUNS="3"                               # opsional, repetisi per prompt per fase

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:20128";
const API_KEY = process.env.GATEWAY_API_KEY;
const MODEL = process.env.MODEL;
const RUNS = parseInt(process.env.RUNS || "3", 10);

if (!API_KEY) {
  console.error("GATEWAY_API_KEY wajib diisi.");
  process.exit(1);
}
if (!MODEL) {
  console.error("MODEL wajib diisi, mis. MODEL=bansosmontera/deepseek-v4.1-flash");
  process.exit(1);
}

const PROMPTS = [
  "Write a JavaScript debounce function with a clear example of usage.",
  "Write a Python function that flattens an arbitrarily nested list.",
  "Write a SQL query to find duplicate emails in a users table.",
  "Write a bash command to list the 10 largest files under the current directory.",
  "Implement binary search in Go with a small main function demonstrating it.",
];

const PHASES = ["off", "lite", "full", "ultra"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOnce(prompt, phase) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "x-9router-ponytail": phase,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      stream: false,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /v1/chat/completions -> ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
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
  console.log(`Model: ${MODEL} | ${PROMPTS.length} prompt x ${RUNS} repetisi x ${PHASES.length} fase`);
  console.log(`Gateway: ${GATEWAY_URL} | override via header x-9router-ponytail (settings global tak diubah)\n`);

  const results = {};
  for (const phase of PHASES) {
    const completions = [];
    const prompts = [];
    for (const prompt of PROMPTS) {
      for (let i = 0; i < RUNS; i++) {
        const r = await runOnce(prompt, phase);
        completions.push(r.completionTokens);
        prompts.push(r.promptTokens);
        process.stdout.write(".");
        await sleep(1000);
      }
    }
    results[phase] = {
      completion: stats(completions),
      prompt: stats(prompts),
      samples: completions.length,
    };
    console.log(` ${phase} selesai\n`);
  }

  const base = results.off.completion.mean;
  console.log("\n=== HASIL (completion_tokens = token output) ===");
  console.log("fase   | mean out | median out | mean in | hemat vs off");
  console.log("-------|----------|------------|---------|------------");
  for (const phase of PHASES) {
    const r = results[phase];
    const savedPct = phase === "off" ? "-" : `${(((base - r.completion.mean) / base) * 100).toFixed(1)}%`;
    console.log(
      `${phase.padEnd(6)} | ${String(r.completion.mean).padStart(8)} | ${String(r.completion.median).padStart(10)} | ${String(r.prompt.mean).padStart(7)} | ${savedPct}`
    );
  }
  console.log("\nCatatan: 'mean in' mencakup biaya injeksi system prompt Ponytail.");
  console.log("Hemat bersih = (out_off - out_fase) - (in_fase - in_off).");

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
