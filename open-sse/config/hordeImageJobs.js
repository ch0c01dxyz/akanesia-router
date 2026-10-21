export const HORDE_POLL_INTERVAL_MS = 5000;
export const HORDE_POLL_TIMEOUT_MS = 25 * 60 * 1000;
export const HORDE_HTTP_TIMEOUT_MS = 30000;
export const HORDE_MAX_JSON_BYTES = 256 * 1024;
export const HORDE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const HORDE_MAX_PROMPT_CHARS = 16000;
export const HORDE_JOB_SCOPE = "hordeImageJobs";
// The public delivery host and account used by Horde's horde/r2.py; no R2 wildcard.
export const HORDE_IMAGE_HOSTS = new Set([
  "imgen.aihorde.net",
  "a223539ccf6caa2d76459c9727d276e6.r2.cloudflarestorage.com",
]);
