import { NextResponse } from "next/server";
import { deleteProviderConnectionsByProvider, deleteProviderNode, getProviderConnections, getProviderNodeById, getProviderNodes, updateProviderConnection, updateProviderNode } from "@/models";
import { sanitizeCustomHeaders } from "@/shared/utils/customHeaders.js";
import { isReservedProviderPrefix } from "@/sse/services/model.js";

// PUT /api/provider-nodes/[id] - Update provider node
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, prefix, apiType, baseUrl, customHeaders } = body;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!prefix?.trim()) {
      return NextResponse.json({ error: "Prefix is required" }, { status: 400 });
    }

    // Sama seperti pembuatan node: prefix tidak boleh bertabrakan dengan
    // id/alias provider bawaan agar model node tetap bisa di-routing.
    if (isReservedProviderPrefix(prefix)) {
      return NextResponse.json(
        { error: `Prefix "${prefix.trim()}" is reserved by a built-in provider. Choose a different prefix.` },
        { status: 400 }
      );
    }

    // Sama seperti pembuatan: prefix duplikat antar node membuat node kedua
    // tidak pernah ter-routing (find() exact-match, node pertama menang).
    const prefixClash = (await getProviderNodes()).find((n) => n.prefix === prefix.trim() && n.id !== id);
    if (prefixClash) {
      return NextResponse.json(
        { error: `Prefix "${prefix.trim()}" sudah dipakai node "${prefixClash.name}".` },
        { status: 400 }
      );
    }

    // Only validate apiType for OpenAI Compatible nodes
    if (node.type === "openai-compatible" && (!apiType || !["chat", "responses"].includes(apiType))) {
      return NextResponse.json({ error: "Invalid OpenAI compatible API type" }, { status: 400 });
    }

    if (!baseUrl?.trim()) {
      return NextResponse.json({ error: "Base URL is required" }, { status: 400 });
    }

    let sanitizedBaseUrl = baseUrl.trim();
    
    // Sanitize Base URL for Anthropic Compatible
    if (node.type === "anthropic-compatible") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/messages")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -9); // remove /messages
      }
    }

    // Sanitize Base URL for Custom Embedding (strip trailing slash and /embeddings)
    if (node.type === "custom-embedding") {
      sanitizedBaseUrl = sanitizedBaseUrl.replace(/\/$/, "");
      if (sanitizedBaseUrl.endsWith("/embeddings")) {
        sanitizedBaseUrl = sanitizedBaseUrl.slice(0, -"/embeddings".length);
      }
    }

    const updates = {
      name: name.trim(),
      prefix: prefix.trim(),
      baseUrl: sanitizedBaseUrl,
    };

    // Ide #8: custom headers per node (Advanced Option)
    if (customHeaders !== undefined) {
      const sanitized = sanitizeCustomHeaders(customHeaders);
      if (sanitized.error) {
        return NextResponse.json({ error: sanitized.error }, { status: 400 });
      }
      updates.customHeaders = sanitized.headers;
    }

    if (node.type === "openai-compatible") {
      updates.apiType = apiType;
    }

    const updated = await updateProviderNode(id, updates);

    const connections = await getProviderConnections({ provider: id });
    await Promise.all(connections.map((connection) => (
      updateProviderConnection(connection.id, {
        providerSpecificData: {
          ...(connection.providerSpecificData || {}),
          prefix: prefix.trim(),
          apiType: node.type === "openai-compatible" ? apiType : undefined,
          baseUrl: sanitizedBaseUrl,
          nodeName: updated.name,
          // Propagasi custom headers ke semua koneksi node ini
          ...(updates.customHeaders !== undefined ? { customHeaders: updates.customHeaders } : {}),
        }
      })
    )));

    return NextResponse.json({ node: updated });
  } catch (error) {
    console.log("Error updating provider node:", error);
    return NextResponse.json({ error: "Failed to update provider node" }, { status: 500 });
  }
}

// DELETE /api/provider-nodes/[id] - Delete provider node and its connections
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const node = await getProviderNodeById(id);

    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    await deleteProviderConnectionsByProvider(id);
    await deleteProviderNode(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting provider node:", error);
    return NextResponse.json({ error: "Failed to delete provider node" }, { status: 500 });
  }
}
