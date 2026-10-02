import { NextResponse } from "next/server";
import { getRtkMeter, resetRtkMeter } from "open-sse/rtk/meter.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/debug/token-saver-meter — snapshot agregat pengukuran RTK.
// Data agregat non-sensitif (hitung & byte, tanpa isi request).
export async function GET() {
  try {
    return NextResponse.json({ ok: true, rtk: getRtkMeter() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/debug/token-saver-meter — reset akumulasi meter.
export async function DELETE() {
  try {
    resetRtkMeter();
    return NextResponse.json({ ok: true, rtk: getRtkMeter() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
