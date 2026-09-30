// Id-correlated JSON-RPC 2.0 client over a single WebSocket, for the Codex
// app-server transport.
//
// Ported from OmniRoute's open-sse/executors/codex/appServerClient.ts (types stripped).
//
// Ported from the stdio JSON-RPC pattern in `devin-cli-agentic.ts` (monotonic id,
// pending-request map settled on responses, notification vs response
// discrimination, settle-once) onto the wreq-js WebSocket transport used by the
// existing Codex WS path.
//
// The critical addition over the other transports is a catch-all handler for
// server -> client ServerRequests: the app-server can ask the client to approve a
// command / patch / permission. OmniRoute is a ROUTER — the harness that consumes
// it owns tool execution and policy — so codex must never stall a turn on its own
// interactive approval. Every inbound ServerRequest is always answered: approval
// prompts are auto-DENIED by default (they gate codex's OWN host execution, not
// the harness's tools; auto-approval is an explicit operator opt-in — hardening
// after the #11205 security review), and anything else we can't service gets a
// JSON-RPC error so the id is always settled and the turn never hangs.

// The set of ServerRequest methods that are approval prompts (see PROTOCOL-DIGEST
// "Server -> client REQUESTS"). All of these get an auto-DENIAL decision unless
// the operator explicitly opted into auto-approval (hardening after the #11205
// security review): these prompts gate codex's OWN command/file/permission
// execution on the host, NOT the harness's dynamic tools (those travel the
// separate item/tool/call passthrough), so denying by default never sabotages
// harness tool calls — it closes a prompt-injection → host-execution path.
const APPROVAL_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "applyPatchApproval",
  "execCommandApproval",
]);

const ROUTER_APPROVAL_NOTE = "router: harness-controlled execution";
const ROUTER_DENIAL_NOTE =
  "router: denied by default (set codexAppServerAutoApprove to opt in)";

/**
 * The app-server → client REQUEST method by which codex invokes a harness-defined
 * (dynamic) function tool. See appServerEvents.ts:CODEX_APPSERVER_TOOL_CALL_METHOD.
 * A stateless router cannot execute the harness's tool, so this is handled by a
 * PASSTHROUGH handler (surface it as a Responses function_call and complete the
 * turn) rather than by the default -32601 rejection.
 */
const TOOL_CALL_REQUEST_METHOD = "item/tool/call";

export class CodexAppServerClient {
  constructor(options = {}) {
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationHandler = () => {};
    this.toolCallHandler = null;
    this.websocketFn = options.websocketFn ?? null;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.autoApproveApprovals = options.autoApproveApprovals === true;
    this.closed = false;
  }

  /**
   * Open the WebSocket and attach the capability token as `Authorization: Bearer`.
   * Do NOT add any chatgpt.com Origin/WS header normalization here — the local
   * app-server wants only the Authorization header.
   */
  async connect(url, token) {
    if (!this.websocketFn) {
      throw new Error("Codex app-server websocket transport unavailable");
    }
    // wreq-js's websocket() REQUIRES a browser/os impersonation profile alongside
    // headers — the same shape the existing Codex WS path uses (codex.ts:980).
    // Omitting browser/os makes the native call hang/throw, so the app-server
    // turn never connects. The local app-server ignores the impersonation
    // fingerprint; only the Authorization Bearer <redacted> for its ws-auth.
    this.ws = await this.websocketFn(url, {
      browser: "chrome_142",
      os: "windows",
      headers: { Authorization: `Bearer ${token}` },
    });
    this.ws.onmessage = (event) => this.onFrame(event.data);
    this.ws.onerror = (event) => this.failAll(event?.message ?? "app-server socket error");
    this.ws.onclose = () => this.failAll("app-server connection closed");
  }

  /** Send a ClientRequest and resolve when its id-matched response arrives. */
  request(method, params, timeoutMs = this.defaultTimeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.closed) {
        reject(new Error(`Cannot send ${method}: app-server connection is not open`));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  /** Send a ClientNotification (no id, no reply expected — e.g. turn/interrupt). */
  notify(method, params) {
    if (!this.ws || this.closed) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  /** Register the handler that receives server -> client NOTIFICATIONS (no id). */
  onNotification(fn) {
    this.notificationHandler = fn;
  }

  /**
   * Register the handler for the `item/tool/call` server → client ServerRequest
   * (a harness function-tool invocation). When set, `item/tool/call` is routed to
   * this handler INSTEAD of the default -32601 rejection; the handler must settle
   * the id via the provided `respond`/`respondError`. When unset, `item/tool/call`
   * falls through to the default rejection (keeps the turn unstuck).
   */
  onToolCall(fn) {
    this.toolCallHandler = fn;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws?.close(1000, "done");
    } catch {
      /* socket close race — ignore */
    }
  }

  /** Parse one inbound frame and dispatch by JSON-RPC shape. */
  onFrame(raw) {
    let msg;
    try {
      const line = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
      msg = JSON.parse(line);
    } catch {
      // A non-JSON frame is unusable; drop it rather than crash the socket.
      return;
    }

    const hasId = msg.id !== undefined && msg.id !== null;
    const hasMethod = typeof msg.method === "string";

    if (hasId && !hasMethod) {
      // A RESPONSE to one of our ClientRequests → settle the pending map.
      const id = msg.id;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error) {
        const err = msg.error;
        pending.reject(new Error(`${String(err.code ?? "error")}: ${String(err.message ?? "unknown")}`));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    if (hasMethod && hasId) {
      // A server -> client REQUEST → we MUST reply with the matching id or the turn stalls.
      const id = msg.id;
      const method = msg.method;
      // A harness function-tool invocation is routed to the passthrough handler
      // (if registered) so the executor can surface it as a Responses function_call
      // and complete the turn. The handler owns settling the id.
      if (method === TOOL_CALL_REQUEST_METHOD && this.toolCallHandler) {
        this.toolCallHandler(id, msg.params, {
          respond: (result) => this.respondToRequest(id, result),
          respondError: (code, message) => this.respondErrorToRequest(id, code, message),
        });
        return;
      }
      this.answerServerRequest(id, method);
      return;
    }

    if (hasMethod) {
      // A server -> client NOTIFICATION → hand to the stream.
      this.notificationHandler(msg.method, msg.params);
    }
  }

  /**
   * Always answer an inbound ServerRequest so its id is settled. Approval
   * prompts are auto-DENIED unless the operator opted into auto-approval
   * (hardening after the #11205 security review): they gate codex's OWN host
   * command/file execution, not the harness's tools. Anything we cannot
   * service gets a JSON-RPC error so the id is still settled.
   */
  answerServerRequest(id, method) {
    if (!this.ws || this.closed) return;
    if (APPROVAL_REQUEST_METHODS.has(method)) {
      // ReviewDecision — "denied" by default; "approved" only with the explicit
      // operator opt-in. The note field is advisory; the decision string is
      // what codex acts on.
      const approved = this.autoApproveApprovals;
      this.ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            decision: approved ? "approved" : "denied",
            note: approved ? ROUTER_APPROVAL_NOTE : ROUTER_DENIAL_NOTE,
          },
        })
      );
      return;
    }
    // Non-approval server request we do not service here: reject the id so the
    // app-server does not wait on us (belt-and-suspenders; keeps turns unstuck).
    this.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: `router: unsupported server request "${method}"`,
        },
      })
    );
  }

  /** Settle an inbound ServerRequest id with a JSON-RPC result. */
  respondToRequest(id, result) {
    if (!this.ws || this.closed) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  /** Settle an inbound ServerRequest id with a JSON-RPC error. */
  respondErrorToRequest(id, code, message) {
    if (!this.ws || this.closed) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  failAll(reason) {
    const err = new Error(reason);
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(err);
    }
    this.notificationHandler("__transport_closed__", { reason });
  }
}
