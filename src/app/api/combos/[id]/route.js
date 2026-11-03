import { NextResponse } from "next/server";
import { getComboById, updateCombo, deleteCombo, getComboByName, getSettings, updateSettings } from "@/lib/localDb";
import { isValidComboModels } from "@/lib/combosPortable";
import { resetComboRotation } from "open-sse/services/combo.js";

// Validate combo name: only a-z, A-Z, 0-9, -, _
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// Strategi combo dikunci NAMA (bukan id): rename harus memindahkan entrinya,
// hapus harus membersihkannya. Kalau tidak, strategi hilang diam-diam saat
// rename, dan combo baru yang kebetulan memakai nama lama mewarisi strategi
// basi. Fail-open: gagal migrasi tidak boleh menggagalkan rename/hapus.
async function moveComboStrategy(prevName, nextName) {
  try {
    if (!prevName) return;
    const strategies = (await getSettings()).comboStrategies || {};
    if (!(prevName in strategies)) return;
    const updated = { ...strategies };
    const entry = updated[prevName];
    delete updated[prevName];
    if (nextName) updated[nextName] = entry;
    await updateSettings({ comboStrategies: updated });
  } catch (error) {
    console.log("Error migrating combo strategy:", error);
  }
}

// GET /api/combos/[id] - Get combo by ID
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);
    
    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }
    
    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error fetching combo:", error);
    return NextResponse.json({ error: "Failed to fetch combo" }, { status: 500 });
  }
}

// PUT /api/combos/[id] - Update combo
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }
      
      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    if (!isValidComboModels(body.models)) {
      return NextResponse.json({ error: "models harus berupa array string" }, { status: 400 });
    }

    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);
    if (prev?.name && combo.name !== prev.name) await moveComboStrategy(prev.name, combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// PATCH /api/combos/[id] - Partial update combo
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Combo id is required" }, { status: 400 });
    }
    const body = await request.json();

    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Request body is empty" }, { status: 400 });
    }

    // Validate name format if provided
    if (body.name) {
      if (!VALID_NAME_REGEX.test(body.name)) {
        return NextResponse.json({ error: "Name can only contain letters, numbers, -, _ and ." }, { status: 400 });
      }

      // Check if name already exists (exclude current combo)
      const existing = await getComboByName(body.name);
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Combo name already exists" }, { status: 400 });
      }
    }

    if (!isValidComboModels(body.models)) {
      return NextResponse.json({ error: "models harus berupa array string" }, { status: 400 });
    }

    // Capture previous name to invalidate rotation state on rename
    const prev = await getComboById(id);
    const combo = await updateCombo(id, body);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    // Invalidate rotation state (models/strategy/name may have changed)
    if (prev?.name) resetComboRotation(prev.name);
    if (combo.name && combo.name !== prev?.name) resetComboRotation(combo.name);
    if (prev?.name && combo.name !== prev.name) await moveComboStrategy(prev.name, combo.name);

    return NextResponse.json(combo);
  } catch (error) {
    console.log("Error partially updating combo:", error);
    return NextResponse.json({ error: "Failed to update combo" }, { status: 500 });
  }
}

// DELETE /api/combos/[id] - Delete combo
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const prev = await getComboById(id);
    const success = await deleteCombo(id);
    
    if (!success) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    if (prev?.name) resetComboRotation(prev.name);
    if (prev?.name) await moveComboStrategy(prev.name, null);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting combo:", error);
    return NextResponse.json({ error: "Failed to delete combo" }, { status: 500 });
  }
}
