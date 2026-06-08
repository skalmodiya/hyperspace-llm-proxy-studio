/**
 * Shared LLM provider types — framework-independent.
 * These are the contracts an SDK extraction would expose.
 */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "litellm"
  | "sap-ai-core";

export interface Model {
  /** Stable identifier returned by the provider (e.g. "anthropic--claude-4.6-sonnet"). */
  id: string;
  /** Human-friendly label. */
  name: string;
  provider: ProviderId;
  /** "chat" | "embedding" | "image" etc. */
  type: "chat" | "embedding" | "unknown";
  contextWindow?: number;
  capabilities?: string[];
  /** Free-form metadata — pricing, owned_by, etc. */
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
  /** Optional provider-specific extras (passed through). */
  extras?: Record<string, unknown>;
}

export interface ChatResponse {
  id?: string;
  provider: ProviderId;
  model: string;
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Citations from search-augmented providers (Perplexity via LiteLLM). */
  citations?: string[];
  /** Untouched upstream payload — surfaced in the Raw JSON viewer. */
  raw?: unknown;
}

export interface EmbeddingRequest {
  provider: ProviderId;
  model: string;
  /** Single string or batch. */
  input: string | string[];
  /** Gemini-only fields */
  taskType?:
    | "RETRIEVAL_QUERY"
    | "RETRIEVAL_DOCUMENT"
    | "SEMANTIC_SIMILARITY"
    | "CLASSIFICATION"
    | "CLUSTERING";
  title?: string;
}

export interface EmbeddingVector {
  index: number;
  values: number[];
  /** Echo of the input text (truncated). */
  inputPreview?: string;
}

export interface EmbeddingResponse {
  provider: ProviderId;
  model: string;
  vectors: EmbeddingVector[];
  dimensions: number;
  usage?: {
    promptTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

export interface LLMProvider {
  readonly id: ProviderId;
  listModels(): Promise<Model[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** Streaming chat — yields incremental text deltas. */
  chatStream?(
    request: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk>;
  embeddings?(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface ChatStreamChunk {
  /** Incremental text added to the assistant message. */
  delta: string;
  finishReason?: string;
  usage?: ChatResponse["usage"];
  citations?: string[];
}

export class ProviderError extends Error {
  status: number;
  provider: ProviderId;
  upstream?: unknown;
  constructor(
    provider: ProviderId,
    status: number,
    message: string,
    upstream?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.upstream = upstream;
  }
}

/**
 * Client-safe label map. Lives here (instead of `providers/index.ts`) so the
 * browser can import labels without pulling in server-only adapter code that
 * uses `node:fs` etc.
 */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  litellm: "LiteLLM",
  "sap-ai-core": "SAP AI Core",
};
