import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";

// GET /api/providers/[id]/export — export semua koneksi provider sebagai JSON.
// PENTING: mengembalikan apiKey ASLI (tidak disanitasi). Hanya untuk dipakai
// lewat dashboard oleh admin lokal; jangan log respons ini.
export async function GET(request, { params }) {
  const { id: providerId } = await params;
  if (!providerId || typeof providerId !== "string") {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }

  const connections = await getProviderConnections({ provider: providerId });

  return NextResponse.json({
    version: 1,
    providerId,
    exportedAt: new Date().toISOString(),
    connections: connections.map((c) => ({
      // Identitas
      name: c.name ?? null,
      email: c.email ?? null,
      authType: c.authType,
      // Kredensial (sensitif — file export harus disimpan aman)
      apiKey: c.apiKey ?? null,
      accessToken: c.accessToken ?? null,
      refreshToken: c.refreshToken ?? null,
      idToken: c.idToken ?? null,
      // Pengaturan
      isActive: c.isActive !== false,
      priority: c.priority ?? null,
      globalPriority: c.globalPriority ?? null,
      defaultModel: c.defaultModel ?? null,
      displayName: c.displayName ?? null,
      providerSpecificData: c.providerSpecificData ?? null,
    })),
  });
}
