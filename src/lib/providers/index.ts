/**
 * Provider registry — server-only. Imports actual adapter classes (which use
 * node:fs, fetch internals, etc.). Client code MUST import PROVIDER_LABELS
 * from "./types" instead, not from this file.
 */
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { LiteLLMProvider } from "./litellm";
import { OpenAIProvider } from "./openai";
import { SapAiCoreProvider } from "./sap-ai-core";
import type { LLMProvider, ProviderId } from "./types";

// Re-export for server callers that already import { PROVIDER_LABELS } from "@/lib/providers".
export { PROVIDER_LABELS } from "./types";

const ALL: Record<ProviderId, LLMProvider> = {
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  gemini: new GeminiProvider(),
  litellm: new LiteLLMProvider(),
  "sap-ai-core": new SapAiCoreProvider(),
};

function hyperspaceEnabled(): boolean {
  // Default true unless the env explicitly turns it off ("false"/"0"/"no").
  const v = process.env.ENABLE_HYPERSPACE_PROVIDERS?.toLowerCase().trim();
  if (!v) return true;
  return !["false", "0", "no", "off"].includes(v);
}

function aiCoreEnabled(): boolean {
  // Disabled only if explicitly turned off; presence of credentials is checked
  // lazily at request time.
  const v = process.env.ENABLE_SAP_AI_CORE?.toLowerCase().trim();
  if (!v) return true;
  return !["false", "0", "no", "off"].includes(v);
}

export function getProvider(id: ProviderId): LLMProvider {
  if (id === "sap-ai-core" && !aiCoreEnabled()) {
    throw new Error("SAP AI Core is disabled by ENABLE_SAP_AI_CORE=false");
  }
  if (id !== "sap-ai-core" && !hyperspaceEnabled()) {
    throw new Error(
      `Provider "${id}" is disabled by ENABLE_HYPERSPACE_PROVIDERS=false`
    );
  }
  const p = ALL[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export function listProviderIds(): ProviderId[] {
  const ids: ProviderId[] = [];
  if (aiCoreEnabled()) ids.push("sap-ai-core");
  if (hyperspaceEnabled()) {
    ids.push("anthropic", "openai", "gemini", "litellm");
  }
  return ids;
}
