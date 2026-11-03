import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), prepare: vi.fn(), close: vi.fn(), rows: [], unavailable: false }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } }));
vi.mock("os", () => ({ homedir: () => "/mock/home" }));
vi.mock("fs/promises", () => ({ access: mocks.access, constants: { R_OK: 4 } }));
vi.mock("child_process", () => ({ execFile: (...args) => args.at(-1)(new Error("sqlite3 unavailable")) }));
vi.mock("@/lib/db/withSqliteFile.js", () => ({
  withSqliteFile: async (file, fn) => {
    if (mocks.unavailable) throw new Error("SQLITE_CANTOPEN");
    try { return await fn({ prepare: mocks.prepare }); } finally { mocks.close(); }
  },
}));
const { GET } = await import("../../src/app/api/oauth/cursor/auto-import/route.js");
const platform = process.platform;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.unavailable = false;
  mocks.access.mockResolvedValue();
  mocks.prepare.mockImplementation(() => ({ get: (key) => mocks.rows.find((row) => row.key === key) }));
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
});
afterEach(() => Object.defineProperty(process, "platform", { value: platform, configurable: true }));

describe("Cursor auto-import exact-key extraction", () => {
  it("reports the attempted locations when no readable database exists", async () => {
    mocks.access.mockRejectedValue(new Error("ENOENT"));
    const response = await GET();
    expect(response.body.found).toBe(false);
    expect(response.body.error).toContain("Cursor database not found. Checked locations:");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("extracts exact token keys and closes the SQLite handle", async () => {
    mocks.rows = [{ key: "cursorAuth/accessToken", value: "token" }, { key: "storage.serviceMachineId", value: "machine" }];
    expect((await GET()).body).toEqual({ found: true, accessToken: "token", machineId: "machine" });
    expect(mocks.prepare).toHaveBeenCalledWith("SELECT value FROM itemTable WHERE key=? LIMIT 1");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("unwraps JSON-encoded values", async () => {
    mocks.rows = [{ key: "cursorAuth/accessToken", value: '"token"' }, { key: "storage.serviceMachineId", value: '"machine"' }];
    expect((await GET()).body).toMatchObject({ found: true, accessToken: "token", machineId: "machine" });
  });

  it("supports the explicit legacy token and machine key aliases", async () => {
    mocks.rows = [{ key: "cursorAuth/token", value: "legacy" }, { key: "telemetry.machineId", value: "machine" }];
    expect((await GET()).body).toMatchObject({ found: true, accessToken: "legacy", machineId: "machine" });
  });

  it("does not extract similarly named unrelated token fields", async () => {
    mocks.rows = [{ key: "cursorAuth/unrelatedAccessToken", value: "unrelated" }, { key: "storage.unrelatedMachineId", value: "other" }];
    expect((await GET()).body).toMatchObject({ found: false, windowsManual: true });
  });

  it("offers manual import when SQLite and the CLI are unavailable", async () => {
    mocks.unavailable = true;
    expect((await GET()).body).toMatchObject({ found: false, windowsManual: true });
  });

  it("probes Linux database paths before attempting import", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    mocks.access.mockRejectedValue(new Error("ENOENT"));
    expect((await GET()).body.found).toBe(false);
    expect(mocks.access).toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("uses the Unix database path fallback for other Unix platforms", async () => {
    Object.defineProperty(process, "platform", { value: "freebsd", configurable: true });
    expect((await GET()).body).toMatchObject({ found: false, windowsManual: true });
    expect(mocks.access).toHaveBeenCalled();
  });
});
