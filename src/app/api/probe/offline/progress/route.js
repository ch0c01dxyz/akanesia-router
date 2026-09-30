// GET /api/probe/offline/progress?runId=... — baca progres baterai offline.
//
// Penyimpanan in-memory via globalThis.__probeProgress (dibagi dengan
// route POST offline). Entri kedaluwarsa > 5 menit dibersihkan saat dibaca
// dan dianggap hilang (404).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROGRESS_TTL_MS = 5 * 60 * 1000;

function progressStore() {
  if (!globalThis.__probeProgress) globalThis.__probeProgress = new Map();
  return globalThis.__probeProgress;
}

export async function GET(request) {
  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId) {
    return NextResponse.json({ error: "run tidak ditemukan" }, { status: 404 });
  }

  const store = progressStore();
  // Sapu entri kedaluwarsa setiap kali ada pembacaan.
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - (v?.updatedAt || 0) > PROGRESS_TTL_MS) store.delete(k);
  }

  const entri = store.get(runId);
  if (!entri) {
    return NextResponse.json({ error: "run tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({ done: entri.done, total: entri.total });
}
