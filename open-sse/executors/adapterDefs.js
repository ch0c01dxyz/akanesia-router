/**
 * Definisi adapter executor (ide #1: lazy-load executor).
 *
 * Tabel statis providerId → { file, exportName, args }.
 * File executor TIDAK di-import di sini — di-load lazy via getAdapter()
 * (open-sse/executors/index.js) memakai dynamic import + file URL.
 *
 * Daftarkan executor baru DI SINI (menggantikan map eager di index.js).
 * Lalu jalankan: node scripts/generate-registry-index.mjs
 * untuk me-regenerasi open-sse/executors/adapters.manifest.js.
 */
export const ADAPTER_DEFS = {
  antigravity: { file: "./antigravity.js", exportName: "AntigravityExecutor", args: [] },
  agy: { file: "./antigravity.js", exportName: "AntigravityExecutor", args: ["agy"] },
  azure: { file: "./azure.js", exportName: "AzureExecutor", args: [] },
  "gemini-cli": { file: "./gemini-cli.js", exportName: "GeminiCLIExecutor", args: [] },
  github: { file: "./github.js", exportName: "GithubExecutor", args: [] },
  iflow: { file: "./iflow.js", exportName: "IFlowExecutor", args: [] },
  qoder: { file: "./qoder.js", exportName: "QoderExecutor", args: [] },
  "qoder-cn": { file: "./qoder.js", exportName: "QoderExecutor", args: ["qoder-cn"] },
  kiro: { file: "./kiro.js", exportName: "KiroExecutor", args: [] },
  kimchi: { file: "./kimchi.js", exportName: "KimchiExecutor", args: [] },
  codex: { file: "./codex.js", exportName: "CodexExecutor", args: [] },
  cursor: { file: "./cursor.js", exportName: "CursorExecutor", args: [] },
  cu: { file: "./cursor.js", exportName: "CursorExecutor", args: [] },
  vertex: { file: "./vertex.js", exportName: "VertexExecutor", args: ["vertex"] },
  "vertex-partner": { file: "./vertex.js", exportName: "VertexExecutor", args: ["vertex-partner"] },
  opencode: { file: "./opencode.js", exportName: "OpenCodeExecutor", args: [] },
  "opencode-go": { file: "./opencode-go.js", exportName: "OpenCodeGoExecutor", args: [] },
  "opencode-zen": { file: "./opencode-zen.js", exportName: "OpenCodeZenExecutor", args: [] },
  "grok-web": { file: "./grok-web.js", exportName: "GrokWebExecutor", args: [] },
  "grok-cli": { file: "./grok-cli.js", exportName: "GrokCliExecutor", args: [] },
  gcli: { file: "./grok-cli.js", exportName: "GrokCliExecutor", args: [] },
  gb: { file: "./grok-cli.js", exportName: "GrokCliExecutor", args: [] },
  "perplexity-web": { file: "./perplexity-web.js", exportName: "PerplexityWebExecutor", args: [] },
  "ollama-local": { file: "./ollama-local.js", exportName: "OllamaLocalExecutor", args: [] },
  commandcode: { file: "./commandcode.js", exportName: "CommandCodeExecutor", args: [] },
  "xiaomi-tokenplan": { file: "./xiaomi-tokenplan.js", exportName: "XiaomiTokenplanExecutor", args: [] },
  "xiaomi-mimo": { file: "./xiaomi-mimo.js", exportName: "XiaomiMimoExecutor", args: [] },
  "mimo-free": { file: "./mimo-free.js", exportName: "MimoFreeExecutor", args: [] },
  mmf: { file: "./mimo-free.js", exportName: "MimoFreeExecutor", args: [] },
  "codebuddy-cn": { file: "./codebuddy-cn.js", exportName: "CodeBuddyExecutor", args: [] },
  "codebuddy-intl": { file: "./codebuddy-intl.js", exportName: "CodeBuddyIntlExecutor", args: [] },
  trae: { file: "./trae.js", exportName: "default", args: [] },
  zed: { file: "./zed.js", exportName: "default", args: [] },
  "zed-hosted": { file: "./zed.js", exportName: "default", args: ["zed-hosted"] },
  windsurf: { file: "./windsurf.js", exportName: "default", args: [] },
  "devin-cli": { file: "./devin-cli.js", exportName: "DevinCliExecutor", args: [] },
  "devin-cli-agentic": { file: "./devin-cli.js", exportName: "DevinCliExecutor", args: ["devin-cli-agentic"] },
  pollinations: { file: "./pollinations.js", exportName: "PollinationsExecutor", args: [] },
  moonshot: { file: "./moonshot.js", exportName: "MoonshotExecutor", args: [] },
  cheaperinference: { file: "./cheaperinference.js", exportName: "CheaperInferenceExecutor", args: [] },
  freebuff: { file: "./freebuff.js", exportName: "FreebuffExecutor", args: [] },
  "ghe-copilot": { file: "./ghe-copilot.js", exportName: "GheCopilotExecutor", args: [] },
  "zenmux-free": { file: "./zenmux-free.js", exportName: "ZenmuxFreeExecutor", args: [] },
  auggie: { file: "./auggie.js", exportName: "AuggieExecutor", args: [] },
  "clova-studio": { file: "./clova-studio.js", exportName: "ClovaStudioExecutor", args: [] },
  bedrock: { file: "./bedrock.js", exportName: "BedrockExecutor", args: [] },
  br: { file: "./bedrock.js", exportName: "BedrockExecutor", args: [] },
  "bedrock-xai": { file: "./bedrock.js", exportName: "BedrockExecutor", args: ["bedrock-xai"] },
  brx: { file: "./bedrock.js", exportName: "BedrockExecutor", args: ["bedrock-xai"] },
  "minimax-code": { file: "./minimax-code.js", exportName: "MinimaxCodeExecutor", args: ["minimax-code"] },
  "minimax-code-global": { file: "./minimax-code.js", exportName: "MinimaxCodeExecutor", args: ["minimax-code-global"] },
};

