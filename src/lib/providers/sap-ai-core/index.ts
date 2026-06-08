/**
 * SAP AI Core provider adapter.
 *
 * AI Core hosts models from multiple vendors. We dispatch by family:
 *   - anthropic   → Anthropic Messages API shape  → POST /v2/inference/deployments/{id}/invoke
 *   - openai      → OpenAI Chat Completions shape → POST /v2/inference/deployments/{id}/chat/completions
 *   - embedding   → OpenAI Embeddings shape       → POST /v2/inference/deployments/{id}/embeddings
 *
 * Streaming uses the same SSE shape per family that the upstream model serves.
 * Both Anthropic-on-AI-Core and OpenAI-on-AI-Core follow their public SSE
 * conventions, so we reuse our existing parsers.
 */
import { parseSSE } from "../base";
import {
  type ChatRequest,
  type ChatResponse,
  type ChatStreamChunk,
  type EmbeddingRequest,
  type EmbeddingResponse,
  type LLMProvider,
  type Model,
  ProviderError,
} from "../types";
import { getCredentials } from "./credentials";
import { getAccessToken } from "./token";
import {
  findOrchestrationDeployment,
  listAsModels,
  tryResolveDeployment,
  type ResolvedDeployment,
} from "./deployments";

/**
 * Per-request resource group. Reads from a runtime override (Settings UI) or
 * the AICORE_RESOURCE_GROUP env var, defaulting to "default".
 */
let runtimeResourceGroup: string | null = null;
export function setResourceGroup(rg: string) {
  runtimeResourceGroup = rg.trim() || null;
}
export function getResourceGroup(): string {
  return (
    runtimeResourceGroup ??
    process.env.AICORE_RESOURCE_GROUP?.trim() ??
    "default"
  );
}

export class SapAiCoreProvider implements LLMProvider {
  readonly id = "sap-ai-core" as const;

  async listModels(): Promise<Model[]> {
    return listAsModels(getResourceGroup());
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const dep = await tryResolveDeployment(req.model, getResourceGroup());
    // No direct deployment matches → it must be an orchestration-routable
    // model (the dropdown lists those when an orchestration deployment is
    // present). Send it via orchestration.
    if (!dep) return this.chatViaOrchestration(req);
    if (dep.type === "embedding") {
      throw new ProviderError(
        this.id,
        400,
        `${dep.modelName} is an embedding deployment, not a chat model.`
      );
    }
    // Direct deployment found. OpenAI deployments use the dedicated
    // /chat/completions path; everything else goes through orchestration.
    if (dep.family === "openai") return this.chatOpenAI(req, dep);
    return this.chatViaOrchestration(req);
  }

  async *chatStream(
    req: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk> {
    const dep = await tryResolveDeployment(req.model, getResourceGroup());
    if (!dep) {
      yield* this.streamViaOrchestration(req, signal);
      return;
    }
    if (dep.family === "openai") {
      yield* this.streamOpenAI(req, dep, signal);
    } else {
      yield* this.streamViaOrchestration(req, signal);
    }
  }

  async embeddings(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const dep = await tryResolveDeployment(req.model, getResourceGroup());
    if (!dep) {
      throw new ProviderError(
        this.id,
        400,
        `Embedding model "${req.model}" is not deployed in resource group ` +
          `"${getResourceGroup()}". Embeddings on AI Core require a direct ` +
          `deployment of the embedding model (orchestration is for chat).`
      );
    }
    if (dep.type !== "embedding") {
      throw new ProviderError(
        this.id,
        400,
        `${dep.modelName} is not an embedding deployment.`
      );
    }
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const data = await this.invokeJson<{
      data: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens?: number; total_tokens?: number };
    }>(dep, "/embeddings", { input: inputs, model: dep.modelName });

    const vectors = (data.data ?? []).map((d, i) => ({
      index: d.index ?? i,
      values: d.embedding,
      inputPreview: previewText(inputs[d.index ?? i]),
    }));
    return {
      provider: this.id,
      model: dep.modelName,
      vectors,
      dimensions: vectors[0]?.values.length ?? 0,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      raw: data,
    };
  }

  // --- family: routed via the Orchestration Service ----------------------
  //
  // SAP's official ai-sdk-js routes Anthropic / Mistral / Cohere / Llama
  // through a single orchestration deployment using the URL:
  //   POST /v2/inference/deployments/{orchestrationDeploymentId}/completion
  // with an OpenAI-shape request envelope. The orchestration service
  // translates to and from each underlying model's native shape.
  //
  // We do the same here. If no orchestration deployment is found in the
  // resource group, surface a clear, actionable error rather than the
  // mystery 404 you'd otherwise see hitting `/invoke` on an Anthropic
  // deployment that doesn't expose it.

  private async resolveOrchestrationOrThrow(): Promise<ResolvedDeployment> {
    const dep = await findOrchestrationDeployment(getResourceGroup());
    if (!dep) {
      throw new ProviderError(
        this.id,
        404,
        "No 'orchestration' deployment found in resource group '" +
          getResourceGroup() +
          "'. Anthropic, Mistral, Cohere and Llama models on SAP AI Core " +
          "must be served via the Orchestration Service. Create an " +
          "orchestration deployment in AI Core Launchpad and retry."
      );
    }
    return dep;
  }

  private async chatViaOrchestration(req: ChatRequest): Promise<ChatResponse> {
    const dep = await this.resolveOrchestrationOrThrow();
    const body = this.buildOrchestrationBody(req, false);
    const data = await this.invokeJson<OrchestrationCompletionResponse>(
      dep,
      "/completion",
      body
    );
    // Orchestration normalizes to OpenAI shape, with the underlying provider
    // result available on `orchestration_result` for raw-payload viewers.
    const choice = data.orchestration_result?.choices?.[0];
    return {
      id: data.request_id ?? data.orchestration_result?.id,
      provider: this.id,
      model: req.model,
      content: choice?.message?.content ?? "",
      finishReason: choice?.finish_reason,
      usage: {
        promptTokens: data.orchestration_result?.usage?.prompt_tokens,
        completionTokens: data.orchestration_result?.usage?.completion_tokens,
        totalTokens: data.orchestration_result?.usage?.total_tokens,
      },
      raw: data,
    };
  }

  private async *streamViaOrchestration(
    req: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk> {
    const dep = await this.resolveOrchestrationOrThrow();
    const body = this.buildOrchestrationBody(req, true);
    let res: Response;
    try {
      res = await this.invokeStream(dep, "/completion", body, signal);
    } catch (err) {
      // Some orchestration / model combinations on AI Core return a 400 with
      // "Streaming is not supported for this model." Rather than failing the
      // request, transparently fall back to a non-streaming call and yield
      // the full content as a single delta. The user-visible result is the
      // same answer, just without the typing-effect UX.
      if (
        err instanceof ProviderError &&
        err.status === 400 &&
        /streaming is not supported/i.test(err.message)
      ) {
        const nonStream = await this.chatViaOrchestration(req);
        yield {
          delta: nonStream.content,
          finishReason: nonStream.finishReason,
          usage: nonStream.usage,
        };
        return;
      }
      throw err;
    }
    if (!res.body) throw new ProviderError(this.id, 0, "No stream body");

    for await (const ev of parseSSE(res.body)) {
      if (!ev.data || ev.data === "[DONE]") continue;
      try {
        const j = JSON.parse(ev.data) as {
          orchestration_result?: {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };
        };
        const choice = j.orchestration_result?.choices?.[0];
        const delta = choice?.delta?.content ?? "";
        const finish = choice?.finish_reason;
        if (delta) yield { delta };
        if (finish) {
          yield {
            delta: "",
            finishReason: finish,
            usage: {
              promptTokens: j.orchestration_result?.usage?.prompt_tokens,
              completionTokens:
                j.orchestration_result?.usage?.completion_tokens,
              totalTokens: j.orchestration_result?.usage?.total_tokens,
            },
          };
        }
      } catch {
        /* malformed event */
      }
    }
  }

  /**
   * Build the orchestration request body. The model is passed under
   * `module_configurations.llm_module_config.model_name`, which is how
   * orchestration knows which underlying provider to dispatch to.
   */
  private buildOrchestrationBody(req: ChatRequest, stream: boolean) {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }
    return {
      orchestration_config: {
        module_configurations: {
          llm_module_config: {
            model_name: req.model,
            model_params: {
              ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
              ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            },
          },
          templating_module_config: {
            template: messages,
          },
        },
        stream,
      },
      input_params: {},
      ...(req.extras ?? {}),
    };
  }

  // --- family: OpenAI on AI Core ------------------------------------------
  //
  // OpenAI deployments on SAP AI Core are backed by Azure OpenAI under the
  // hood, so the inference URL needs an `?api-version=...` query parameter
  // (without it, AI Core returns a generic 404). The SDK pins this to
  // `2024-12-01-preview`; we mirror that here. Override per-tenant if
  // needed via AICORE_OPENAI_API_VERSION.
  private get openAiApiVersion(): string {
    return process.env.AICORE_OPENAI_API_VERSION ?? "2024-12-01-preview";
  }

  private async chatOpenAI(
    req: ChatRequest,
    dep: ResolvedDeployment
  ): Promise<ChatResponse> {
    const body = this.buildOpenAIBody(req, false);
    const data = await this.invokeJson<OpenAIChatResponse>(
      dep,
      `/chat/completions?api-version=${this.openAiApiVersion}`,
      body
    );
    const choice = data.choices?.[0];
    return {
      id: data.id,
      provider: this.id,
      model: dep.modelName,
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

  private async *streamOpenAI(
    req: ChatRequest,
    dep: ResolvedDeployment,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamChunk> {
    const body = this.buildOpenAIBody(req, true);
    const res = await this.invokeStream(
      dep,
      `/chat/completions?api-version=${this.openAiApiVersion}`,
      body,
      signal
    );
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

  private buildOpenAIBody(req: ChatRequest, stream: boolean) {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.systemPrompt) {
      messages.push({ role: "system", content: req.systemPrompt });
    }
    for (const m of req.messages) {
      messages.push({ role: m.role, content: m.content });
    }
    // Apply the same gpt-5/4.1/o-series rule as the standalone OpenAI adapter.
    const useNewParam = /gpt-5|gpt-4\.1|^o\d/i.test(req.model);
    return {
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

  // --- HTTP plumbing -------------------------------------------------------

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "AI-Resource-Group": getResourceGroup(),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private inferenceUrl(dep: ResolvedDeployment, path: string): string {
    const creds = getCredentials();
    const tail = path.startsWith("/") ? path : `/${path}`;
    return `${creds.apiBase}/v2/inference/deployments/${dep.id}${tail}`;
  }

  private async invokeJson<T>(
    dep: ResolvedDeployment,
    path: string,
    body: unknown
  ): Promise<T> {
    const token = await getAccessToken();
    const res = await fetch(this.inferenceUrl(dep, path), {
      method: "POST",
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        this.id,
        res.status,
        `AI Core ${res.status}: ${text.slice(0, 300)}`,
        safeJson(text)
      );
    }
    return (await res.json()) as T;
  }

  private async invokeStream(
    dep: ResolvedDeployment,
    path: string,
    body: unknown,
    signal?: AbortSignal
  ): Promise<Response> {
    const token = await getAccessToken();
    const res = await fetch(this.inferenceUrl(dep, path), {
      method: "POST",
      headers: {
        ...this.buildHeaders(token),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        this.id,
        res.status,
        `AI Core stream ${res.status}: ${text.slice(0, 300)}`,
        safeJson(text)
      );
    }
    return res;
  }
}

// --- vendor response shapes (only the fields we read) ----------------------

interface OrchestrationCompletionResponse {
  request_id?: string;
  // Orchestration nests the OpenAI-shape upstream response under this key.
  orchestration_result?: {
    id?: string;
    choices?: Array<{
      message?: { role?: string; content?: string };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
}

interface OpenAIChatResponse {
  id: string;
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

function previewText(s?: string): string | undefined {
  if (!s) return undefined;
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
