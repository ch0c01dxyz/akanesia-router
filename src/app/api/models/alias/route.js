import { NextResponse } from "next/server";
import { getModelAliases, setModelAlias, deleteModelAlias, renameModelAlias, getProviderConnections } from "@/models";
import {
  validateRouteMaskInput,
  normalizeMaskKey,
  cariKoneksiBerkredensial,
} from "@/lib/routeMasking.js";
import { invalidateModelsCache } from "@/lib/modelsCache.js";
import { invalidateMaskAliasCache } from "@/sse/services/model.js";

export const dynamic = "force-dynamic";

// GET /api/models/alias - Get all aliases
export async function GET() {
  try {
    const aliases = await getModelAliases();
    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching aliases:", error);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

// PUT /api/models/alias - Set model alias (dipakai fitur Route-Masking)
// Body: { alias, model, renameFrom? }
// - renameFrom: nama samaran lama saat rename — server melakukan tulis-baru +
//   hapus-lama dalam satu transaksi (atomik, tidak ada data loss).
// Validasi: format nama samaran aman, nama samaran != nama model asli,
// target punya koneksi berkredensial, dan nama samaran belum dipakai mask lain.
export async function PUT(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Body harus JSON yang valid." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body harus JSON object." }, { status: 400 });
    }
    const { model, alias, renameFrom } = body;

    const validasi = validateRouteMaskInput(alias, model);
    if (!validasi.ok) {
      return NextResponse.json({ error: validasi.error }, { status: 400 });
    }
    const aliasKey = normalizeMaskKey(validasi.alias);
    const oldKey = renameFrom ? normalizeMaskKey(renameFrom) : null;
    const isRename = !!oldKey && oldKey !== aliasKey;

    const existing = (await getModelAliases()) || {};

    // Cegah chaining: target tidak boleh berupa nama samaran mask lain
    // (getModelInfo tidak me-resolve berantai). renameFrom dikecualikan
    // karena key lama dihapus atomik dalam request yang sama.
    const targetLower = validasi.target.toLowerCase();
    const chainedKey = Object.keys(existing).find(
      (k) => k.toLowerCase() === targetLower && k.toLowerCase() !== (oldKey || "")
    );
    if (chainedKey) {
      return NextResponse.json(
        { error: "Model target tidak boleh berupa nama samaran mask lain." },
        { status: 400 }
      );
    }

    // Proteksi overwrite: nama samaran yang sudah dipakai mask lain tidak
    // boleh dibajak diam-diam (kecuali rename dari dirinya sendiri).
    if (Object.prototype.hasOwnProperty.call(existing, aliasKey) && !(oldKey && oldKey === aliasKey)) {
      return NextResponse.json(
        { error: `Nama samaran "${aliasKey}" sudah dipakai mask lain.` },
        { status: 409 }
      );
    }

    // Syarat Route-Masking: model target harus benar-benar bisa dipakai —
    // provider-nya punya koneksi aktif + berkredensial (aturan yang sama
    // dengan filter /v1/models).
    let connections = [];
    try {
      connections = await getProviderConnections();
    } catch (e) {
      console.log("Could not fetch connections for route-masking validation:", e);
    }
    const koneksi = cariKoneksiBerkredensial(validasi.providerPart, connections);
    if (!koneksi) {
      return NextResponse.json(
        { error: `Provider "${validasi.providerPart}" tidak punya koneksi aktif berkredensial.` },
        { status: 400 }
      );
    }

    if (isRename) {
      await renameModelAlias(oldKey, aliasKey, validasi.target);
    } else {
      await setModelAlias(aliasKey, validasi.target);
    }
    invalidateModelsCache();
    invalidateMaskAliasCache();

    return NextResponse.json({ success: true, model: validasi.target, alias: aliasKey });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}

// DELETE /api/models/alias?alias=xxx - Delete alias
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json({ error: "Alias required" }, { status: 400 });
    }

    await deleteModelAlias(normalizeMaskKey(alias));
    invalidateModelsCache();
    invalidateMaskAliasCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting alias:", error);
    return NextResponse.json({ error: "Failed to delete alias" }, { status: 500 });
  }
}
