import { NextResponse } from "next/server";
import { listIncidents, getProviderConnections } from "@/models";
import { enrichWithProviderName } from "@/lib/providerDisplayName.js";

export const dynamic = "force-dynamic";

// GET /api/quota-incidents - Daftar insiden kuota & error (ide #4, untuk dashboard)
export async function GET() {
  try {
    const incidents = await listIncidents();
    // Perkaya dengan nama tampilan yang terbaca (lihat providerDisplayName.js).
    let connections = [];
    try {
      connections = await getProviderConnections();
    } catch {
      // abaikan — fallback ke nama provider / id mentah
    }
    return NextResponse.json({ incidents: enrichWithProviderName(incidents, connections) });
  } catch (error) {
    console.log("Error fetching quota incidents:", error);
    return NextResponse.json({ error: "Failed to fetch quota incidents" }, { status: 500 });
  }
}
