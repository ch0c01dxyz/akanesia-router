import { NextResponse } from "next/server";
import { listIncidents } from "@/models";

export const dynamic = "force-dynamic";

// GET /api/quota-incidents - Daftar insiden kuota & error (ide #4, untuk dashboard)
export async function GET() {
  try {
    const incidents = await listIncidents();
    return NextResponse.json({ incidents });
  } catch (error) {
    console.log("Error fetching quota incidents:", error);
    return NextResponse.json({ error: "Failed to fetch quota incidents" }, { status: 500 });
  }
}
