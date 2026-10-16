import { NextResponse } from "next/server";
import { checkOpencodeInstalled, getSetupGuide } from "open-sse/utils/opencodeBridgeSupervisor.js";

// GET /api/opencode-bridge/status — cek apakah opencode2 terinstall
export async function GET() {
  try {
    const status = await checkOpencodeInstalled();
    return NextResponse.json({
      ...status,
      setupGuide: status.installed ? null : getSetupGuide(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Gagal cek status opencode2" },
      { status: 500 }
    );
  }
}
