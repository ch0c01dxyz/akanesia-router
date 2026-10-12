import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

// Label provider yang terbaca di log terminal: provider kompatibel dinamis
// (openai-compatible-*/anthropic-compatible-*) id-nya UUID mentah —
// pakai nama koneksi bila ada (mis. "mee", bukan "openai-compatible-chat-<uuid>").
export function providerLogLabel(provider, credentials) {
  if (
    (isOpenAICompatibleProvider(provider) || isAnthropicCompatibleProvider(provider)) &&
    credentials?.connectionName
  ) {
    return credentials.connectionName;
  }
  return provider;
}
