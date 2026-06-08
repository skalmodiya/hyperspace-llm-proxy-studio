/**
 * OpenAI adapter — proxies to /openai/v1.
 * Standard chat/completions + embeddings.
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

interface OpenAIModelsResponse {
  data?: Array<{ id: string; owned_by?: string; object?: string }>;
}

interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

const CHAT_FALLBACK = ["gpt-5.4", "gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4.1-mini"];
const EMBED_FALLBACK = ["text-embedding-3-small", "text-embedding-3-large"];

export class OpenAIProvider extends BaseProvider {
  readonly id = "openai" as const;
  protected readonly basePath = "/openai/v1";

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.request<OpenAIModelsResponse>({
        method: "GET",
        path: "/models",
      });
      const list = res.data ?? [];
      if (list.length === 0) return this.fallback();
      return list.map((m) => ({
        id: m.id,
        name: m.id,
        provider: this.id,
        type: this.classify(m.id),
        metadata: { owned_by: m.owned_by },
      }));
    } catch {
      return this.fallback();
    }
  }

  private classify(id: string): Model["type"] {
    if (id.includes("embedding") || id.includes("embed")) return "embedding";
    return "chat";
  }

  private fallback(): Model[] {
    return [
      ...CHAT_FALLBACK.map((id) => ({
        id,
        name: id,
        provider: this.id,
        type: "chat" as const,
      })),
      ...EMBED_FALLBACK.map((id) => ({
        id,
        name: id,
        provider: this.id,
        type: "embedding" as const,
      })),
    ];
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = this.buildChatBody(req, false);
    const data = await this.request<OpenAIChatResponse>({
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
        if (delta) yield { delta };
        if (finish) yield { delta: "", finishReason: finish };
      } catch {
        /* malformed */
      }
    }
  }

  async embeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const body = { model: req.model, input: inputs };
    const data = await this.request<OpenAIEmbeddingResponse>({
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
    // GPT-5 / GPT-4.1+ models reject `max_tokens` and require
    // `max_completion_tokens`. Older models still accept the legacy field.
    // We pick by model id so the same adapter works on both.
    const useNewParam = /gpt-5|gpt-4\.1|^o\d/i.test(req.model);
    return {
      model: req.model,
      messages,
      temperature: req.temperature,
      ...(req.maxTokens !== undefined
        ? useNewParam
          ? { max_completion_tokens: req.maxTokens }
          : { max_tokens: req.maxTokens }
        : {}),
      stream,
      ...(req.extras ?? {}),
    };
  }
}

function previewText(s?: string): string | undefined {
  if (!s) return undefined;
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
