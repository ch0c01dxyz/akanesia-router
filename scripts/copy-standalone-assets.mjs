import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export function copyStandaloneAssets({ projectRoot = process.cwd(), distDir = process.env.NEXT_DIST_DIR || ".next" } = {}) {
  if (process.env.NEXT_TRACING_ROOT_MODE === "workspace") {
    console.log("[standalone-assets] Skipping workspace-traced CLI build; CLI packaging handles assets");
    return;
  }

  const buildDir = resolve(projectRoot, distDir);
  const standaloneDir = resolve(buildDir, "standalone");

  if (!existsSync(standaloneDir)) {
    console.log(`[standalone-assets] No standalone build found at ${standaloneDir}`);
    return;
  }

  const staticSource = resolve(buildDir, "static");
  const staticDestination = resolve(standaloneDir, distDir, "static");
  if (existsSync(staticSource)) {
    cpSync(staticSource, staticDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied static assets to ${staticDestination}`);
  }

  const publicSource = resolve(projectRoot, "public");
  const publicDestination = resolve(standaloneDir, "public");
  if (existsSync(publicSource)) {
    cpSync(publicSource, publicDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied public assets to ${publicDestination}`);
  }

  // Without it beside server.js the standalone build serves requests unsanitized.
  const serverWrapperSource = resolve(projectRoot, "custom-server.js");
  const serverWrapperDestination = resolve(standaloneDir, "custom-server.js");
  if (existsSync(serverWrapperSource)) {
    cpSync(serverWrapperSource, serverWrapperDestination, { force: true });
    console.log(`[standalone-assets] Copied custom-server.js to ${serverWrapperDestination}`);
  }

  // Runtime deps reached only via dynamic file-URL imports (open-sse executors).
  // Next's output tracing misses them, so the standalone build cannot resolve
  // them at runtime. Copy each from the project's node_modules if absent.
  // Keep in sync with the dynamic executor loader (open-sse/executors).
  const extraRuntimeDeps = ["node-machine-id", "undici", "uuid"];
  const standaloneNodeModules = resolve(standaloneDir, "node_modules");
  for (const dep of extraRuntimeDeps) {
    const depSource = resolve(projectRoot, "node_modules", dep);
    const depDestination = resolve(standaloneNodeModules, dep);
    if (!existsSync(depSource)) {
      console.warn(`[standalone-assets] Runtime dep "${dep}" not found in node_modules; skipped`);
      continue;
    }
    if (existsSync(depDestination)) continue;
    cpSync(depSource, depDestination, { recursive: true, force: true });
    console.log(`[standalone-assets] Copied runtime dep ${dep} to ${depDestination}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(dirname(fileURLToPath(import.meta.url)), "copy-standalone-assets.mjs")) {
  copyStandaloneAssets();
}
