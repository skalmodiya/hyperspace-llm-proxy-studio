/**
 * Gemini adapter — proxies to /gemini.
 * Uses the v1beta REST shape: {model}:generateContent / :embedContent.
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

interface GeminiModelEntry {
  name: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
}

interface GeminiModelsResponse {
  models?: GeminiModelEntry[];
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }>; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface GeminiEmbeddingResponse {
  // single-input format
  embedding?: { values: number[] };
  // batch format (predictions[].embeddings.values)
  predictions?: Array<{ embeddings?: { values?: number[] }; values?: number[] }>;
}

const CHAT_FALLBACK = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
];
const EMBED_FALLBACK = ["gemini-embedding"];

export class GeminiProvider extends BaseProvider {
  readonly id = "gemini" as const;
  protected readonly basePath = "/gemini";

  async listModels(): Promise<Model[]> {
    try {
      const res = await this.request<GeminiModelsResponse>({
        method: "GET",
        path: "/v1beta/models",
      });
      const list = res.models ?? [];
      if (list.length === 0) return this.fallback();
      return list.map((m) => ({
        id: stripModelPrefix(m.name),
        name: m.displayName ?? stripModelPrefix(m.name),
        provider: this.id,
        type: this.classify(m),
        contextWindow: m.inputTokenLimit,
        capabilities: m.supportedGenerationMethods,
      }));
    } catch {
      return this.fallback();
    }
  }

  private classify(m: GeminiModelEntry): Model["type"] {
    const id = m.name.toLowerCase();
    if (id.includes("embedding") || id.includes("embed")) return "embedding";
    if (m.supportedGenerationMethods?.includes("embedContent")) return "embedding";
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
    const body = this.buildChatBody(req);
    const data = await this.request<GeminiGenerateResponse>({
      path: `/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
      body,
    });
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    return {
      provider: this.id,
      model: req.model,
      content: text,
      finishReason: cand?.finishReason,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
      raw: data,
    };
  }

  async *chatStream(
    req: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk> {
    const body = this.buildChatBody(req);
    const res = await this.streamRequest({
      path: `/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`,
      body,
      signal,
    });
    if (!res.body) throw new ProviderError(this.id, 0, "No stream body");

    for await (const ev of parseSSE(res.body)) {
      if (!ev.data) continue;
      try {
        const j = JSON.parse(ev.data) as GeminiGenerateResponse;
        const cand = j.candidates?.[0];
        const delta = (cand?.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("");
        if (delta) yield { delta };
        if (cand?.finishReason) {
          yield {
            delta: "",
            finishReason: cand.finishReason,
            usage: {
              promptTokens: j.usageMetadata?.promptTokenCount,
              completionTokens: j.usageMetadata?.candidatesTokenCount,
              totalTokens: j.usageMetadata?.totalTokenCount,
            },
          };
        }
      } catch {
        /* malformed */
      }
    }
  }

  async embeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    // The proxy accepts a Vertex-style "instances" array. We use that shape so
    // both single and batch inputs flow through the same call.
    const body = {
      instances: inputs.map((content) => ({
        content,
        ...(req.taskType ? { task_type: req.taskType } : {}),
        ...(req.title ? { title: req.title } : {}),
      })),
    };
    const data = await this.request<GeminiEmbeddingResponse>({
      path: `/v1beta/models/${encodeURIComponent(req.model)}:embedContent`,
      body,
    });

    const vectors: EmbeddingResponse["vectors"] = [];
    if (Array.isArray(data.predictions)) {
      data.predictions.forEach((p, i) => {
        const values = p.embeddings?.values ?? p.values ?? [];
        vectors.push({
          index: i,
          values,
          inputPreview: previewText(inputs[i]),
        });
      });
    } else if (data.embedding?.values) {
      vectors.push({
        index: 0,
        values: data.embedding.values,
        inputPreview: previewText(inputs[0]),
      });
    }
    return {
      provider: this.id,
      model: req.model,
      vectors,
      dimensions: vectors[0]?.values.length ?? 0,
      raw: data,
    };
  }

  private buildChatBody(req: ChatRequest) {
    const contents = req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    return {
      contents,
      ...(req.systemPrompt
        ? {
            systemInstruction: { parts: [{ text: req.systemPrompt }] },
          }
        : {}),
      generationConfig: {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      },
      ...(req.extras ?? {}),
    };
  }
}

function stripModelPrefix(name: string) {
  return name.startsWith("models/") ? name.slice(7) : name;
}

function previewText(s?: string): string | undefined {
  if (!s) return undefined;
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}
