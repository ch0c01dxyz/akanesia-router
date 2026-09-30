# Vendored dependencies (duckduckgo-web challenge solver)

The DuckDuckGo anti-abuse challenge solver (`../challenge.js`, ported from
OmniRoute) needs `parse5` to count HTML elements in upstream-supplied challenge
scripts with browser-exact fidelity. 9router has no package manager step for
`open-sse/executors`, so the required runtime files are vendored here.

- `parse5/` — parse5 8.0.1 (MIT), `dist/*.js` runtime only (no `.d.ts`, no `src/`)
- `node_modules/entities/` — entities (the version parse5 8.0.1 depends on),
  `dist/*.js` runtime only, placed under `node_modules/` so parse5's bare
  `from 'entities/decode'` / `from 'entities/escape'` imports resolve via
  Node's normal parent-directory walk-up.

Both packages are unmodified upstream builds (LICENSE + package.json included).
Re-vendor with: `npm pack parse5@8.0.1` (and its `entities` dependency),
extract, and copy the `dist/*.js` files here.
