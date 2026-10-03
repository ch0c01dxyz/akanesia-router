// Ponytail injector: appends the "lazy senior dev" instruction into the system
// message of the final request body, just before dispatch to the provider executor.

import { injectSystemPrompt } from "./systemInject.js";
import { PONYTAIL_PROMPTS, PONYTAIL_LEVELS } from "./ponytailPrompt.js";
import { PONYTAIL_HEADER } from "../config/runtimeConfig.js";

export function injectPonytail(body, format, level) {
  injectSystemPrompt(body, format, PONYTAIL_PROMPTS[level]);
}

const PONYTAIL_LEVEL_VALUES = Object.values(PONYTAIL_LEVELS);

// Resolve override Ponytail per-request via header x-9router-ponytail.
// Mengembalikan { enabled, level } bila header valid, atau null bila tidak
// ada header / nilai tak dikenal (caller pakai setting global).
export function resolvePonytailOverride(headers, ponytailEnabled, ponytailLevel) {
  const raw = headers?.[PONYTAIL_HEADER];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const v = raw.trim().toLowerCase();
  if (v === "off" || v === "0" || v === "false" || v === "disabled" || v === "no") {
    return { enabled: false, level: ponytailLevel };
  }
  if (PONYTAIL_LEVEL_VALUES.includes(v)) {
    return { enabled: true, level: v };
  }
  return null;
}
