import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { TABLES, buildCreateTableSql } from "@/lib/db/schema.js";

// resolveNodePrefixId (model.js) memakai find() exact-match: node kedua dengan
// prefix yang sama tidak akan pernah ter-routing (semua modelnya lari ke node
// pertama). Karena itu POST/PUT node harus menolak prefix yang sudah dipakai
// node lain — saat ini tidak ada pengecekan itu.
const memDb = new DatabaseSync(":memory:");
memDb.exec(buildCreateTableSql("providerNodes", TABLES.providerNodes));
memDb.exec(buildCreateTableSql("providerConnections", TABLES.providerConnections));

const fakeAdapter = {
  get: (sql, params = []) => memDb.prepare(sql).get(...params),
  all: (sql, params = []) => memDb.prepare(sql).all(...params),
  run: (sql, params = []) => memDb.prepare(sql).run(...params),
  transaction: (fn) => fn(),
};

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => fakeAdapter,
}));

const { POST } = await import("@/app/api/provider-nodes/route.js");
const { PUT } = await import("@/app/api/provider-nodes/[id]/route.js");

function req(method, body) {
  return new Request("http://localhost/api/provider-nodes", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function nodeBody(name, prefix, extra = {}) {
  return { name, prefix, apiType: "chat", baseUrl: "https://example.com/v1", type: "openai-compatible", ...extra };
}

beforeEach(() => {
  memDb.exec("DELETE FROM providerNodes");
  memDb.exec("DELETE FROM providerConnections");
});

describe("prefix node duplikat", () => {
  it("POST kedua dengan prefix sama ditolak 400", async () => {
    const first = await POST(req("POST", nodeBody("Satu", "acme")));
    expect(first.status).toBe(201);
    const second = await POST(req("POST", nodeBody("Dua", "acme")));
    expect(second.status).toBe(400);
    expect((await second.json()).error).toMatch(/acme/);
  });

  it("prefix beda kapitalisasi tetap boleh (matching runtime case-sensitive)", async () => {
    expect((await POST(req("POST", nodeBody("Satu", "acme")))).status).toBe(201);
    expect((await POST(req("POST", nodeBody("Dua", "Acme")))).status).toBe(201);
  });

  it("PUT rename ke prefix node lain ditolak, PUT dengan prefix sendiri lolos", async () => {
    const a = await (await POST(req("POST", nodeBody("Satu", "acme")))).json();
    const b = await (await POST(req("POST", nodeBody("Dua", "beta")))).json();
    const clash = await PUT(
      req("PUT", { name: "Dua", prefix: "acme", apiType: "chat", baseUrl: "https://example.com/v1" }),
      { params: Promise.resolve({ id: b.node.id }) },
    );
    expect(clash.status).toBe(400);
    const ok = await PUT(
      req("PUT", { name: "Dua", prefix: "beta", apiType: "chat", baseUrl: "https://example.com/v1" }),
      { params: Promise.resolve({ id: b.node.id }) },
    );
    expect(ok.status).toBe(200);
    expect(a.node.id).not.toBe(b.node.id);
  });
});
