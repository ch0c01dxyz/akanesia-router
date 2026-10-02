import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { PROVIDERS } from "open-sse/config/providers.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { normalizeProviderOverride as normalizeOverride } from "@/lib/providerOverrides";

export const dynamic = "force-dynamic";

// Aturan validasi (blocked list dsb.) tinggal di @/lib/providerOverrides
// agar PATCH /api/settings menegakkan aturan yang sama (tidak bisa di-bypass).

async function readOverrides() {
  const settings = await getSettings();
  return settings.providerOverrides || {};
}

/**
 * GET /api/providers/[id]/overrides — override user untuk provider ini
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    // URL bisa memakai alias (gcli, cc…) — semua di-key dengan id registry kanonis
    const canonical = resolveProviderAlias(id);
    const override = (await readOverrides())[canonical] || {};
    // Header bawaan diambil langsung dari transport registry — single source of
    // truth, jadi UI pre-fill persis apa yang dikirim provider ke upstream.
    return NextResponse.json({
      headers: override.headers || {},
      builtinHeaders: PROVIDERS[canonical]?.headers || {},
    });
  } catch (error) {
    console.log("Error getting provider overrides:", error);
    return NextResponse.json({ error: "Gagal mengambil overrides" }, { status: 500 });
  }
}

/**
 * PUT /api/providers/[id]/overrides — body: { headers: {name: value} }
 * Payload kosong menghapus override.
 */
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const canonical = resolveProviderAlias(id);
    const body = await request.json().catch(() => ({}));
    const { override, error } = normalizeOverride(body);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }
    const current = await readOverrides();
    const next = { ...current };
    if (override) next[canonical] = override;
    else delete next[canonical];
    await updateSettings({ providerOverrides: next });
    return NextResponse.json({ headers: override?.headers || {} });
  } catch (error) {
    console.log("Error saving provider overrides:", error);
    return NextResponse.json({ error: "Gagal menyimpan overrides" }, { status: 500 });
  }
}
