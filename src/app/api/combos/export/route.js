import { NextResponse } from "next/server";
import { getCombos, getSettings } from "@/lib/localDb";
import { buildCombosExport } from "@/lib/combosPortable";

export const dynamic = "force-dynamic";

// GET /api/combos/export — download all combos as a secret-free JSON file.
// Only name, kind, model list, and dashboard strategy are included; no
// connections, API keys, or other settings ever leave the server here.
export async function GET() {
  try {
    const combos = await getCombos();
    const settings = await getSettings();
    const exportData = buildCombosExport(combos, settings.comboStrategies || {});
    const stamp = exportData.exportedAt.replace(/[:.]/g, "-");
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="akanesia-combos-${stamp}.json"`,
      },
    });
  } catch (error) {
    console.log("Error exporting combos:", error);
    return NextResponse.json({ error: "Failed to export combos" }, { status: 500 });
  }
}
