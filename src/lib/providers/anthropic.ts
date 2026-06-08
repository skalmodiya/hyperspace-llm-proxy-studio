/**
 * Anthropic adapter — proxies to /anthropic/v1.
 * Translates the Anthropic Messages API into our generic ChatRequest/Response shape.
 */
import { BaseProvider, parseSSE } from "./base";
import {
  type ChatRequest,
  type ChatResponse,
  type ChatStreamChunk,
  type Model,
  ProviderError,
} from "./types";

interface AnthropicModelEntry {
  id: string;
  display_name?: string;
  type?: string;
  created_at?: string;
}

interface AnthropicModelsResponse {
  data?: AnthropicModelEntry[];
  models?: AnthropicModelEntry[];
}

interface AnthropicMessageResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string }>;
  model: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const FALLBACK_MODELS = [
  "anthropic--claude-4.7-opus",
  "anthropic--claude-4.6-sonnet",
  "anthropic--claude-4.6-opus",
  "anthropic--claude-4.5-haiku",
  "anthropic--claude-4.5-sonnet",
  "anthropic--claude-4.5-opus",
  "anthropic--claude-4-sonnet",
];

export class AnthropicProvider extends BaseProvider {
  readonly id = "anthropic" as const;
  protected readonly basePath = "/anthropic/v1";

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.request<AnthropicModelsResponse>({
        method: "GET",
        path: "/models",
      });
      const list = res.data ?? res.models ?? [];
      if (list.length === 0) return this.fallback();
      return list.map((m) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        provider: this.id,
        type: "chat" as const,
        metadata: { created_at: m.created_at },
      }));
    } catch {
      return this.fallback();
    }
  }

  private fallback(): Model[] {
    return FALLBACK_MODELS.map((id) => ({
      id,
      name: id,
      provider: this.id,
      type: "chat" as const,
    }));
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const data = await this.request<AnthropicMessageResponse>({
      path: "/messages",
      body,
    });

    const text = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    return {
      id: data.id,
      provider: this.id,
      model: data.model,
      content: text,
      finishReason: data.stop_reason,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
        totalTokens:
          (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      raw: data,
    };
  }

  async *chatStream(
    req: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk> {
    const body = this.buildBody(req, true);
    const res = await this.streamRequest({
      path: "/messages",
      body,
      signal,
    });
    if (!res.body) throw new ProviderError(this.id, 0, "No stream body");
    let usage: ChatStreamChunk["usage"];
    let finishReason: string | undefined;

    for await (const ev of parseSSE(res.body)) {
      if (!ev.data || ev.data === "[DONE]") continue;
      try {
        const j = JSON.parse(ev.data);
        if (j.type === "content_block_delta") {
          const delta = j.delta?.text ?? "";
          if (delta) yield { delta };
        } else if (j.type === "message_delta") {
          if (j.delta?.stop_reason) finishReason = j.delta.stop_reason;
          if (j.usage) {
            usage = {
              promptTokens: j.usage.input_tokens,
              completionTokens: j.usage.output_tokens,
            };
          }
        } else if (j.type === "message_stop") {
          yield { delta: "", finishReason, usage };
        }
      } catch {
        /* swallow malformed event */
      }
    }
  }

  private buildBody(req: ChatRequest, stream: boolean) {
    const system = req.systemPrompt;
    const messages = req.messages
      .filter((m) => m.role !== "system" && m.role !== "tool")
      .map((m) => ({ role: m.role, content: m.content }));

    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature,
      stream,
      ...(system ? { system } : {}),
      messages,
      ...(req.extras ?? {}),
    };
  }
}
