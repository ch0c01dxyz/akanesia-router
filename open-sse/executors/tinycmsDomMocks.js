// Runtime DOM shims for the TinyCMS wasm-bindgen glue (browser-targeted Rust).
// Ported from OmniRoute's tinycmsDomMocks.ts (types stripped).
// These are NOT test-only mocks — the WASM module reaches canvas APIs through
// generated JS that expects `window`, `document`, `HTMLCanvasElement`, and
// `CanvasRenderingContext2D` in Node.
//
// Deliberately NOT a module-load side effect: importing this file must not leak
// `global.window` into unrelated code. Call `setupDomMocks()` (or the with-*
// wrappers) around WASM init / payload generation.
//
// Why this is load-bearing:
// Never alias `window` to the Node global. Use a dedicated stub object.
// Always attach a Location-shaped object (`protocol`, `hostname`, `port`,
// `href`, `origin`, …) so even a leftover `window` cannot poison SSR
// frameworks that do `const { protocol, hostname, port } = window.location`.

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function locationIsUsable(value) {
  if (!isRecord(value)) return false;
  return typeof value.protocol === "string" && typeof value.hostname === "string";
}

function createSafeLocation() {
  const location = {
    href: "http://localhost/",
    origin: "http://localhost",
    protocol: "http:",
    host: "localhost",
    hostname: "localhost",
    port: "",
    pathname: "/",
    search: "",
    hash: "",
    assign() {},
    reload() {},
    replace() {},
    toString() {
      return location.href;
    },
  };
  return location;
}

function ensureUsableLocation(target, key) {
  if (!locationIsUsable(target[key])) {
    target[key] = createSafeLocation();
  }
}

export function setupDomMocks() {
  if (typeof global === "undefined") return () => {};

  // A loose record on purpose: assigning the real constructor signatures would
  // fail under DOM lib types. This function exists to overwrite those globals
  // with stubs; it must not be typed as if they were the real ones.
  const g = global;
  const hadWindow = "window" in g;
  const hadWindowCtor = "Window" in g;
  const hadCanvasElement = "HTMLCanvasElement" in g;
  const hadCanvasContext = "CanvasRenderingContext2D" in g;
  const hadDocument = "document" in g;
  const hadGlobalLocation = "location" in g;
  const existingWindow = isRecord(g.window) ? g.window : undefined;
  // Historical toxic alias from older OmniRoute builds: `g.window = g`.
  // Never keep that alias — SSR treats any `window` as a browser and then
  // destructures `window.location`.
  const windowWasGlobalAlias = g.window === g;

  if (!g.Window) g.Window = function Window() {};
  if (!g.HTMLCanvasElement) g.HTMLCanvasElement = function HTMLCanvasElement() {};
  if (!g.CanvasRenderingContext2D) {
    g.CanvasRenderingContext2D = function CanvasRenderingContext2D() {};
  }

  if (!g.document) {
    g.document = {
      createElement(tag) {
        if (tag === "canvas") {
          const canvas = {
            width: 100,
            height: 100,
            getContext(type) {
              if (type === "2d") {
                const ctx = {
                  fillStyle: "",
                  font: "",
                  fillRect() {},
                  fillText() {},
                  toDataURL() {
                    return "data:image/png;base64,MOCK_DATA";
                  },
                };
                Object.setPrototypeOf(ctx, g.CanvasRenderingContext2D.prototype);
                return ctx;
              }
              return null;
            },
            toDataURL() {
              return "data:image/png;base64,MOCK_DATA";
            },
          };
          Object.setPrototypeOf(canvas, g.HTMLCanvasElement.prototype);
          return canvas;
        }
        return null;
      },
    };
  }

  if (windowWasGlobalAlias) {
    delete g.window;
  }

  if (!g.window) {
    const stubWindow = {
      location: createSafeLocation(),
      document: g.document,
    };
    stubWindow.window = stubWindow;
    stubWindow.self = stubWindow;
    g.window = stubWindow;
    Object.setPrototypeOf(stubWindow, g.Window.prototype);
  } else if (existingWindow && existingWindow !== g) {
    // Heal a leftover dedicated window so SSR `getLocationOrigin` can
    // destructure even if this process already had a stub.
    ensureUsableLocation(existingWindow, "location");
    if (g.document && existingWindow.document == null) {
      existingWindow.document = g.document;
    }
  }

  return () => {
    if (!hadWindow || windowWasGlobalAlias) {
      delete g.window;
    } else if (isRecord(g.window)) {
      // A leftover `window` stays installed: never strip `location` off it.
      ensureUsableLocation(g.window, "location");
    }
    if (!hadGlobalLocation) delete g.location;
    if (!hadWindowCtor) delete g.Window;
    if (!hadCanvasElement) delete g.HTMLCanvasElement;
    if (!hadCanvasContext) delete g.CanvasRenderingContext2D;
    if (!hadDocument) delete g.document;
  };
}

export function withTinyCmsDomMocks(fn) {
  const restore = setupDomMocks();
  try {
    return fn();
  } finally {
    restore();
  }
}

export async function withTinyCmsDomMocksAsync(fn) {
  const restore = setupDomMocks();
  try {
    return await fn();
  } finally {
    restore();
  }
}
