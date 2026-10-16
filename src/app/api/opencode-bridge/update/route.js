import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { platform } from "node:os";

// State update global (singleflight)
let updateState = { status: "idle", progress: 0, log: [], error: null };

// POST /api/opencode-bridge/update — jalankan update di background
export async function POST() {
  if (updateState.status === "running") {
    return NextResponse.json({ status: "already_running", ...updateState });
  }

  updateState = { status: "running", progress: 0, log: [], error: null };

  const os = platform();
  // Jalankan async tanpa block response
  runUpdate(os).catch((err) => {
    updateState.status = "error";
    updateState.error = err?.message || String(err);
  });

  return NextResponse.json({ status: "started" });
}

// GET /api/opencode-bridge/update — poll progress
export async function GET() {
  return NextResponse.json(updateState);
}

async function runUpdate(os) {
  const pushLog = (msg) => {
    updateState.log.push(`[${new Date().toISOString()}] ${msg}`);
    if (updateState.log.length > 50) updateState.log.shift();
  };

  pushLog(`Mulai update opencode2 (${os})...`);
  updateState.progress = 10;

  const cmd = os === "win32" ? "bun" : "bash";
  const args = os === "win32"
    ? ["install", "-g", "opencode2@latest"]
    : ["-c", "curl -fsSL https://opencode.ai/install | bash"];

  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line) pushLog(line.slice(0, 200));
      // Estimasi progress dari output
      updateState.progress = Math.min(90, updateState.progress + 5);
    });
    child.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (line) pushLog(`[stderr] ${line.slice(0, 200)}`);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Update gagal dengan exit code ${code}`));
    });

    // Timeout 5 menit
    setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error("Update timeout (5 menit)"));
    }, 5 * 60 * 1000);
  });

  updateState.progress = 100;
  updateState.status = "done";
  pushLog("Update selesai.");
}
