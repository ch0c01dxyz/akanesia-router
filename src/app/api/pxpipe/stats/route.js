import { NextResponse } from "next/server";
import { getPxpipeStats } from "@/lib/pxpipe/events.js";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { enrichWithProviderName } from "@/lib/providerDisplayName.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const recentLimit = Math.min(Number(searchParams.get("limit")) || 100, 500);
    const stats = getPxpipeStats({ recentLimit });
    // Perkaya event history dengan providerName yang terbaca
    // (nama koneksi > nama provider > id mentah).
    let connections = [];
    try {
      connections = await getProviderConnections();
    } catch {
      // abaikan — fallback ke nama provider / id mentah
    }
    if (Array.isArray(stats?.recent)) {
      stats.recent = enrichWithProviderName(stats.recent, connections);
    }
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
