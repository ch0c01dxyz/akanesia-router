import { NextResponse } from "next/server";
import { getWarmupStatus } from "@/lib/fillFirstWarmup.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET() {
  // Status warming koneksi fill-first (ide #2): enabled, state
  // (idle/berjalan/selesai/dimatikan), daftar provider yang ter-warm.
  let warming = null;
  try {
    warming = getWarmupStatus();
  } catch {
    // abaikan: health check tidak boleh gagal karena status warming
  }
  return NextResponse.json({ ok: true, warming }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
