// Alias /v1/multimodal-embeddings -> /v1/embeddings (Jina-compatible clients).
// Re-exports the same handlers so auth, validation and behavior stay identical.
export { POST, OPTIONS } from "../embeddings/route.js";
