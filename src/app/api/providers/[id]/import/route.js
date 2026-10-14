import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getProviderConnections, createProviderConnection } from "@/models";

// AuthType yang dikenal — tolak yang lain.
const KNOWN_AUTH_TYPES = new Set(["apikey", "oauth", "cookie", "none"]);

function sanitizeStr(v, max = 500) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function validateConnection(c) {
  if (!c || typeof c !== "object") return "Connection harus objek";
  const authType = sanitizeStr(c.authType, 50);
  if (!authType || !KNOWN_AUTH_TYPES.has(authType)) {
    return `authType tidak dikenal: ${String(c.authType).slice(0, 50)}`;
  }
  if (authType === "apikey" && !sanitizeStr(c.apiKey, 2000)) {
    return "apikey membutuhkan apiKey yang tidak kosong";
  }
  if (authType === "oauth" && !sanitizeStr(c.email, 320) && !sanitizeStr(c.accessToken, 4000)) {
    return "oauth membutuhkan email atau accessToken";
  }
  return null;
}

// POST /api/providers/[id]/import — terima JSON hasil export, validasi, buat koneksi.
// Body: { providerId, connections: [...] }. Koneksi duplikat (apiKey/email sama) di-skip.
export async function POST(request, { params }) {
  const { id: providerId } = await params;
  if (!providerId || typeof providerId !== "string") {
    return NextResponse.json({ error: "Invalid provider id" }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON valid" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body harus objek JSON" }, { status: 400 });
  }
  if (body.providerId !== providerId) {
    return NextResponse.json({ error: "providerId tidak cocok" }, { status: 400 });
  }
  if (!Array.isArray(body.connections)) {
    return NextResponse.json({ error: "connections harus array" }, { status: 400 });
  }
  if (body.connections.length > 200) {
    return NextResponse.json({ error: "Maksimal 200 koneksi per import" }, { status: 400 });
  }

  const existing = await getProviderConnections({ provider: providerId });
  const existingKeys = new Set(
    existing.filter((c) => c.authType === "apikey" && c.apiKey).map((c) => `key:${c.apiKey}`)
  );
  const existingEmails = new Set(
    existing.filter((c) => c.authType === "oauth" && c.email).map((c) => `email:${c.email.toLowerCase()}`)
  );

  const imported = [];
  const skipped = [];
  const errors = [];

  for (let i = 0; i < body.connections.length; i++) {
    const raw = body.connections[i];
    const err = validateConnection(raw);
    if (err) {
      errors.push({ index: i, error: err });
      continue;
    }

    const authType = sanitizeStr(raw.authType, 50);
    const apiKey = sanitizeStr(raw.apiKey, 2000);
    const email = sanitizeStr(raw.email, 320);

    // Cegah duplikat
    if (authType === "apikey" && apiKey && existingKeys.has(`key:${apiKey}`)) {
      skipped.push({ index: i, reason: "duplikat apiKey", name: sanitizeStr(raw.name, 200) });
      continue;
    }
    if (authType === "oauth" && email && existingEmails.has(`email:${email.toLowerCase()}`)) {
      skipped.push({ index: i, reason: "duplikat email", name: sanitizeStr(raw.name, 200) });
      continue;
    }

    try {
      const conn = await createProviderConnection({
        id: uuidv4(),
        provider: providerId,
        authType,
        name: sanitizeStr(raw.name, 200),
        email,
        apiKey,
        accessToken: sanitizeStr(raw.accessToken, 4000),
        refreshToken: sanitizeStr(raw.refreshToken, 4000),
        idToken: sanitizeStr(raw.idToken, 4000),
        isActive: raw.isActive !== false,
        priority: Number.isInteger(raw.priority) ? raw.priority : null,
        globalPriority: Number.isInteger(raw.globalPriority) ? raw.globalPriority : null,
        defaultModel: sanitizeStr(raw.defaultModel, 200),
        displayName: sanitizeStr(raw.displayName, 200),
        providerSpecificData:
          raw.providerSpecificData && typeof raw.providerSpecificData === "object"
            ? raw.providerSpecificData
            : null,
      });
      imported.push({ index: i, id: conn.id, name: conn.name });
      // Tandai agar duplikat dalam file yang sama juga terdeteksi
      if (apiKey) existingKeys.add(`key:${apiKey}`);
      if (email) existingEmails.add(`email:${email.toLowerCase()}`);
    } catch (e) {
      errors.push({ index: i, error: e.message || "Gagal membuat koneksi" });
    }
  }

  return NextResponse.json({ imported, skipped, errors });
}
