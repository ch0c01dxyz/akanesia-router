import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import {
  listReplayEntries,
  clearReplayLog,
  setReplayMaxBytes,
  getReplayStats,
} from "@/lib/requestReplayBuffer.js";

export const dynamic = "force-dynamic";

// GET /api/replay-log — Daftar entry request upstream yang gagal (ide #7).
// Batas byte buffer diselaraskan dari setting di sini (bukan di hot path),
// sehingga perubahan replayLogMaxBytes berlaku saat dashboard membaca.
export async function GET() {
  try {
    try {
      const settings = await getSettings();
      const maxBytes = Number(settings?.replayLogMaxBytes);
      if (Number.isFinite(maxBytes) && maxBytes > 0) setReplayMaxBytes(maxBytes);
    } catch {
      // Pakai batas terakhir yang tersimpan di buffer.
    }
    return NextResponse.json({
      entries: listReplayEntries(),
      stats: getReplayStats(),
    });
  } catch (error) {
    console.log("Error fetching replay log:", error);
    return NextResponse.json({ error: "Failed to fetch replay log" }, { status: 500 });
  }
}

// DELETE /api/replay-log — Kosongkan buffer replay.
export async function DELETE() {
  try {
    clearReplayLog();
    return NextResponse.json({ ok: true, stats: getReplayStats() });
  } catch (error) {
    console.log("Error clearing replay log:", error);
    return NextResponse.json({ error: "Failed to clear replay log" }, { status: 500 });
  }
}
