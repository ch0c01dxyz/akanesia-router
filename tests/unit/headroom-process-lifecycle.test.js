// Regression test: startHeadroomProxy must not leak the log fd, and stopping
// the proxy must not trigger EBADF (double closeSync on the log fd) as an
// uncaughtException. Uses a fake `headroom` binary (a tiny HTTP server).
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const IS_WINDOWS = process.platform === "win32";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hr-proc-"));
const BIN_DIR = path.join(TMP, "bin");
fs.mkdirSync(BIN_DIR, { recursive: true });

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

let proc, invalidateHeadroomStatusCache;
beforeAll(async () => {
  // Fake headroom binary: `headroom proxy --port <p>` serves /health after a
  // short boot delay (exercises the wait-for-health path); `--version` exits 0.
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("headroom 0.26.0"); process.exit(0); }
const port = Number(args[args.indexOf("--port") + 1]);
const http = require("http");
// Simulate a slow-booting proxy so startHeadroomProxy must poll /health.
setTimeout(() => {
  http.createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("ok"); }
    else { res.writeHead(404); res.end(); }
  }).listen(port, "127.0.0.1");
}, 1500);
`;
  if (IS_WINDOWS) {
    fs.writeFileSync(path.join(BIN_DIR, "headroom.cmd"), `@echo off\r\nnode "${path.join(BIN_DIR, "headroom.js")}" %*\r\n`);
    fs.writeFileSync(path.join(BIN_DIR, "headroom.js"), script);
  } else {
    const p = path.join(BIN_DIR, "headroom");
    fs.writeFileSync(p, script, { mode: 0o755 });
  }
  process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH}`;
  process.env.DATA_DIR = path.join(TMP, "data");
  proc = await import("../../src/lib/headroom/process.js");
  ({ invalidateHeadroomStatusCache } = await import("../../src/lib/headroom/detect.js"));
});

// Dynamic import AFTER env setup so DATA_DIR and PATH are picked up.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("headroom proxy lifecycle (fake binary)", () => {
  it("starts, waits for /health, and stops without EBADF", { timeout: 60000 }, async () => {
    invalidateHeadroomStatusCache();
    const uncaught = [];
    const onUncaught = (e) => uncaught.push(e);
    process.on("uncaughtException", onUncaught);
    try {
      const port = await freePort();
      const started = await proc.startHeadroomProxy({ port });
      expect(started.pid).toBeGreaterThan(0);
      expect(started.alreadyRunning).toBe(false);
      expect(proc.getManagedPid()).toBe(started.pid);

      // /health must be reachable now (start waited for it).
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);

      const stopped = proc.stopHeadroomProxy();
      expect(stopped.stopped).toBe(true);
      expect(proc.getManagedPid()).toBe(null);

      // Give the exited child time to fire any stale listeners — the old
      // code threw EBADF here via double closeSync(outFd).
      await sleep(3000);
      const ebadf = uncaught.filter((e) => e && e.code === "EBADF");
      expect(ebadf).toEqual([]);
      expect(uncaught).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
      try { proc.stopHeadroomProxy(); } catch { /* cleanup */ }
    }
  });
});
