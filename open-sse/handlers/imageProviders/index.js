// Image provider adapter registry
import createOpenAIAdapter, { createCompatibleOpenAIAdapter } from "./openai.js";
import { OPENAI_COMPATIBLE_PREFIX } from "@/shared/constants/providers";
import gemini from "./gemini.js";
import codex from "./codex.js";
import sdwebui from "./sdwebui.js";
import comfyui from "./comfyui.js";
import huggingface from "./huggingface.js";
import nanobanana from "./nanobanana.js";
import falAi from "./falAi.js";
import stabilityAi from "./stabilityAi.js";
import blackForestLabs from "./blackForestLabs.js";
import runwayml from "./runwayml.js";
import cloudflareAi from "./cloudflareAi.js";
import magnific from "./magnific.js";
import deepai from "./deepai.js";
import antigravity from "./antigravity.js";
import segmind from "./segmind.js";
import aihorde from "./aihorde.js";

const ADAPTERS = {
  openai: createOpenAIAdapter("openai"),
  minimax: createOpenAIAdapter("minimax"),
  openrouter: createOpenAIAdapter("openrouter"),
  recraft: createOpenAIAdapter("recraft"),
  "vercel-ai-gateway": createOpenAIAdapter("vercel-ai-gateway"),
  xai: createOpenAIAdapter("xai"),
  venice: createOpenAIAdapter("venice"),
  tokenrouter: createOpenAIAdapter("tokenrouter"),
  sensenova: createOpenAIAdapter("sensenova"),
  gemini,
  codex,
  sdwebui,
  comfyui,
  huggingface,
  nanobanana,
  antigravity,
  "fal-ai": falAi,
  "stability-ai": stabilityAi,
  "black-forest-labs": blackForestLabs,
  runwayml,
  "cloudflare-ai": cloudflareAi,
  magnific,
  deepai,
  segmind,
  aihorde,
};

export function getImageAdapter(provider) {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  // Custom OpenAI-compatible providers have no static entry — their image
  // endpoint is derived from the connection's own baseUrl at request time.
  if (typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX)) {
    return createCompatibleOpenAIAdapter();
  }
  return null;
}

export function isImageProvider(provider) {
  return provider in ADAPTERS
    || (typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX));
}
