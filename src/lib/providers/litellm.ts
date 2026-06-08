/**
 * LiteLLM adapter — proxies to /litellm/v1.
 * OpenAI-compatible. Adds Perplexity citation extraction.
 */
import { BaseProvider, parseSSE } from "./base";
import {
  type ChatRequest,
  type ChatResponse,
  type ChatStreamChunk,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type Model,
  ProviderError,
} from "./types";

interface LiteLLMModelsResponse {
  data?: Array<{ id: string; owned_by?: string; object?: string }>;
}

interface LiteLLMChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
      extensions?: {
        citations?: Array<
          string | { ref_id?: number; title?: string; url?: string }
        >;
      };
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /** Some providers return citations at the top level. */
  citations?: Array<string | { url?: string }>;
}

interface LiteLLMEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

export class LiteLLMProvider extends BaseProvider {
  readonly id = "litellm" as const;
  protected readonly basePath = "/litellm/v1";

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.request<LiteLLMModelsResponse>({
        method: "GET",
        path: "/models",
      });
      const list = res.data ?? [];
      return list.map((m) => ({
        id: m.id,
        name: m.id,
        provider: this.id,
        type: m.id.includes("embedding") ? ("embedding" as const) : ("chat" as const),
        metadata: { owned_by: m.owned_by },
      }));
    } catch {
      // No fallback list — LiteLLM is dynamic by design.
      return [];
    }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = this.buildChatBody(req, false);
    const data = await this.request<LiteLLMChatResponse>({
      path: "/chat/completions",
      body,
    });
    const choice = data.choices?.[0];
    return {
      id: data.id,
      provider: this.id,
      model: data.model,
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      citations: extractCitations(data),
      raw: data,
    };
  }

  async *chatStream(
    req: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk> {
    const body = this.buildChatBody(req, true);
    const res = await this.streamRequest({
      path: "/chat/completions",
      body,
      signal,
    });
    if (!res.body) throw new ProviderError(this.id, 0, "No stream body");

    for await (const ev of parseSSE(res.body)) {
      if (!ev.data || ev.data === "[DONE]") continue;
      try {
        const j = JSON.parse(ev.data);
        const delta = j.choices?.[0]?.delta?.content ?? "";
        const finish = j.choices?.[0]?.finish_reason;
        // Citations may appear top-level OR inside choices[0].message.extensions.
        const citations = extractCitations(j);
        if (delta || (citations && citations.length)) {
          yield {
            delta: delta ?? "",
            ...(citations && citations.length ? { citations } : {}),
          };
        }
        if (finish) yield { delta: "", finishReason: finish };
      } catch {
        /* malformed */
      }
    }
  }

  async embeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const body = { model: req.model, input: inputs };
    const data = await this.request<LiteLLMEmbeddingResponse>({
      path: "/embeddings",
      body,
    });
    const vectors = (data.data ?? []).map((d, i) => ({
      index: d.index ?? i,
      values: d.embedding,
      inputPreview: previewText(inputs[d.index ?? i]),
    }));
    return {
      provider: this.id,
      model: data.model,
      vectors,
      dimensions: vectors[0]?.values.length ?? 0,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      raw: data,
    };
  }

  private buildChatBody(req: ChatRequest, stream: boolean) {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }
    return {
      model: req.model,
      messages,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream,
      ...(req.extras ?? {}),
    };
  }
}

function previewText(s?: string): string | undefined {
  if (!s) return undefined;
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

/**
 * Pull citations out of the various shapes upstream providers use.
 * Perplexity (via the proxy) puts them in `choices[0].message.extensions.citations`
 * as objects of {ref_id, title, url}. Some providers/streams use a top-level
 * `citations: string[]`. We normalize all of them to URL strings.
 */
function extractCitations(payload: unknown): string[] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as {
    citations?: Array<string | { url?: string }>;
    choices?: Array<{
      message?: {
        extensions?: {
          citations?: Array<string | { url?: string }>;
        };
      };
    }>;
  };

  const candidates = [
    p.citations,
    p.choices?.[0]?.message?.extensions?.citations,
  ];

  for (const arr of candidates) {
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const urls = arr
      .map((c) => (typeof c === "string" ? c : c?.url))
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    if (urls.length > 0) return urls;
  }
  return undefined;
}
