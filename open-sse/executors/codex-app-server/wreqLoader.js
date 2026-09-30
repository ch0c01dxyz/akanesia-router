// Dynamic wreq-js loader for the Codex app-server WS transport.
//
// Ported from OmniRoute's open-sse/executors/codex/wreqLoader.ts (types stripped).
// Mirrors open-sse/utils/tlsClient.ts's loadRuntimeModule().

// #12491 — keep the module-name argument dynamic (never a literal string)
// when calling a createRequire()-returned function. Turbopack statically
// detects a literal specifier and rewrites the call to a hashed require()
// target that resolves only via a `.next`-relative symlink generated at
// build time, which is absent from the standalone Docker runtime.
export function loadDynamicModule(requireFn, moduleName) {
  return Reflect.apply(requireFn, undefined, [moduleName]);
}
