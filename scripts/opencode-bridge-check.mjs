// Readiness checker untuk OpenCode bridge (P4, diadopsi dari verify.js
// opencode-free-bridge).
//
// Membedakan "IP throttled" dari "bridge broken" lewat exit code:
//   0 → OK (bridge jalan, upstream menjawab)
//   2 → UPSTREAM THROTTLED/REJECTED (bridge sehat, upstream menolak)
//   1 → BRIDGE BROKEN (binary hilang, serve gagal start, dsb.)
//
// Cara pakai:
//   node scripts/opencode-bridge-check.mjs [--quick]
//
// --quick: hanya cek binary + serve hidup (tanpa session create).

import { checkOpencodeInstalled, ensureBridgeRunning } from "../open-sse/utils/opencodeBridgeSupervisor.js";
import { getGateCooldownStatus } from "../open-sse/utils/opencodeGateCooldown.js";

const QUICK = process.argv.includes("--quick");

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function ok(msg) {
  console.log(msg);
}

// 1. Binary terinstall?
const installed = await checkOpencodeInstalled();
if (!installed.installed) {
  fail(1, `BROKEN: opencode2 tidak terinstall (${installed.path})`);
}
ok(`OK: binary ditemukan (${installed.path})${installed.version ? ` v${installed.version}` : ""}`);

// 2. Serve bisa jalan?
let bridge;
try {
  bridge = await ensureBridgeRunning();
} catch (err) {
  fail(1, `BROKEN: serve gagal start: ${err?.message || err}`);
}
ok(`OK: serve hidup di ${bridge.baseUrl}`);

// 3. Cooldown status (observasional — bedakan throttled vs broken)
for (const scope of ["opencode-go", "opencode-zen"]) {
  const st = getGateCooldownStatus(scope);
  if (st.coolingDown) {
    console.log(`WARN: gate ${scope} cooling down (403 terakhir ${Math.round(st.lastRejectionMsAgo / 1000)} dtk lalu)`);
  }
}

if (QUICK) {
  ok("OK: readiness check lolos (--quick)");
  process.exit(0);
}

// 4. Session create minimal — bedakan upstream reject vs bridge error
try {
  const auth = "Basic " + Buffer.from(`opencode:${bridge.password}`).toString("base64");
  const res = await fetch(`${bridge.baseUrl}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ title: "readiness-check", model: { providerID: "opencode", id: "muse-spark-1.3-contributor-free" } }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 403 || res.status === 429) {
    fail(2, `THROTTLED: upstream menolak session create (${res.status})`);
  }
  if (!res.ok) {
    fail(1, `BROKEN: session create ${res.status}`);
  }
  ok("OK: session create berhasil — bridge + upstream sehat");
  process.exit(0);
} catch (err) {
  if (err?.name === "TimeoutError") fail(1, "BROKEN: session create timeout");
  fail(1, `BROKEN: session create error: ${err?.message || err}`);
}
