import { NextResponse } from "next/server";
import { getCombos, getComboByName, createCombo, deleteCombo, getSettings, updateSettings } from "@/lib/localDb";
import { parseComboImportFile } from "@/lib/combosPortable";

export const dynamic = "force-dynamic";

// POST /api/combos/import — body: a combos-only export file plus optional
// `mode` ("merge" default, or "replace"). The whole file is validated
// before anything is written. Merge never touches existing combos (name
// conflicts are skipped and reported); replace swaps every combo for the
// file's combos and prunes strategies of removed combos.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseComboImportFile(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { mode, combos } = parsed;

  try {
    const existing = await getCombos();
    const created = [];
    const skipped = [];

    if (mode === "replace") {
      for (const combo of existing) {
        await deleteCombo(combo.id);
      }
      for (const combo of combos) {
        const row = await createCombo({ name: combo.name, kind: combo.kind, models: combo.models });
        created.push(row.name);
      }
      // Strategies follow the file exactly: dropped combos lose theirs.
      const nextStrategies = {};
      for (const combo of combos) {
        if (combo.strategy) nextStrategies[combo.name] = combo.strategy;
      }
      await updateSettings({ comboStrategies: nextStrategies });
      return NextResponse.json({ mode, created, skipped, removed: existing.length });
    }

    for (const combo of combos) {
      const clash = await getComboByName(combo.name);
      if (clash) {
        skipped.push(combo.name);
        continue;
      }
      const row = await createCombo({ name: combo.name, kind: combo.kind, models: combo.models });
      created.push(row.name);
    }
    if (created.length > 0) {
      const settings = await getSettings();
      const nextStrategies = { ...(settings.comboStrategies || {}) };
      for (const combo of combos) {
        if (combo.strategy && created.includes(combo.name)) {
          nextStrategies[combo.name] = combo.strategy;
        }
      }
      await updateSettings({ comboStrategies: nextStrategies });
    }
    return NextResponse.json({ mode, created, skipped, removed: 0 });
  } catch (error) {
    console.log("Error importing combos:", error);
    return NextResponse.json({ error: "Failed to import combos" }, { status: 500 });
  }
}
