import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SapAiCoreProvider, setResourceGroup } from "../index";
import {
  clearRuntimeOverride,
  setRuntimeOverride,
  _resetCredentialsCache,
} from "../credentials";
import { clearTokenCache } from "../token";
import { clearDeploymentCache } from "../deployments";

const SAMPLE_KEY = {
  serviceurls: { AI_API_URL: "https://api.ai.test.example.com" },
  clientid: "sb-test",
  clientsecret: "secret",
  url: "https://tenant.authentication.us10.hana.ondemand.com",
};

const DEPLOYMENTS = {
  resources: [
    {
      id: "dep-claude-1",
      modelName: "anthropic--claude-4.6-sonnet",
      status: "RUNNING",
      scenarioId: "foundation-models",
    },
    {
      id: "dep-gpt-1",
      modelName: "gpt-4.1-mini",
      status: "RUNNING",
      scenarioId: "foundation-models",
    },
    {
      id: "dep-emb-1",
      modelName: "text-embedding-3-small",
      status: "RUNNING",
      scenarioId: "foundation-models",
    },
    {
      id: "dep-orch-1",
      modelName: "orchestration",
      status: "RUNNING",
      scenarioId: "orchestration",
    },
  ],
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.AICORE_RESOURCE_GROUP;
  _resetCredentialsCache();
  setRuntimeOverride(JSON.stringify(SAMPLE_KEY));
  clearTokenCache();
  clearDeploymentCache();
  setResourceGroup("default");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  clearRuntimeOverride();
  vi.restoreAllMocks();
});

interface MockCall {
  url: string;
  init?: RequestInit;
}

function mockSequence(responders: Array<(call: MockCall) => Response>) {
  let i = 0;
  const calls: MockCall[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const call: MockCall = { url, init };
    calls.push(call);
    const responder = responders[Math.min(i, responders.length - 1)];
    i++;
    return responder(call);
  }) as unknown as typeof fetch;
  return calls;
}

function tokenResponse() {
  return new Response(
    JSON.stringify({ access_token: "tok", expires_in: 3600 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SapAiCoreProvider", () => {
  it("listModels uses /v2/lm/deployments with the AI-Resource-Group header", async () => {
    const calls = mockSequence([
      tokenResponse,
      () => jsonResponse(DEPLOYMENTS),
    ]);
    setResourceGroup("custom-rg");
    const models = await new SapAiCoreProvider().listModels();
    expect(models.map((m) => m.id)).toContain(
      "anthropic--claude-4.6-sonnet"
    );
    expect(models.map((m) => m.id)).toContain("gpt-4.1-mini");
    expect(models.find((m) => m.id === "text-embedding-3-small")?.type).toBe(
      "embedding"
    );

    // The /v2/lm/deployments call (calls[1]) must carry AI-Resource-Group.
    const lmCall = calls[1];
    expect(lmCall.url).toContain("/v2/lm/deployments");
    const headers = lmCall.init?.headers as Record<string, string>;
    expect(headers["AI-Resource-Group"]).toBe("custom-rg");
    expect(headers.Authorization).toBe("Bearer tok");
  });

  it("dispatches Anthropic-family models through the Orchestration deployment", async () => {
    const calls = mockSequence([
      tokenResponse,
      () => jsonResponse(DEPLOYMENTS),
      () =>
        jsonResponse({
          request_id: "req-1",
          orchestration_result: {
            id: "msg_1",
            choices: [
              {
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 1,
              total_tokens: 6,
            },
          },
        }),
    ]);
    const res = await new SapAiCoreProvider().chat({
      provider: "sap-ai-core",
      model: "anthropic--claude-4.6-sonnet",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("ok");
    expect(res.usage?.totalTokens).toBe(6);
    // The inference call must hit the orchestration deployment, not the
    // Anthropic deployment, on the /completion path.
    const inferenceCall = calls[2];
    expect(inferenceCall.url).toContain(
      "/v2/inference/deployments/dep-orch-1/completion"
    );
    const body = JSON.parse(String(inferenceCall.init?.body));
    expect(body.orchestration_config.module_configurations.llm_module_config.model_name).toBe(
      "anthropic--claude-4.6-sonnet"
    );
  });

  it("returns a clear error when no orchestration deployment exists", async () => {
    // Mock the deployment list with NO orchestration entry.
    const NO_ORCH = {
      resources: DEPLOYMENTS.resources.filter(
        (d) => d.modelName !== "orchestration"
      ),
    };
    mockSequence([tokenResponse, () => jsonResponse(NO_ORCH)]);
    await expect(
      new SapAiCoreProvider().chat({
        provider: "sap-ai-core",
        model: "anthropic--claude-4.6-sonnet",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow(/No 'orchestration' deployment found/);
  });

  it("dispatches OpenAI-family models to /chat/completions with max_completion_tokens for gpt-5+", async () => {
    const calls = mockSequence([
      tokenResponse,
      () => jsonResponse(DEPLOYMENTS),
      () =>
        jsonResponse({
          id: "1",
          choices: [
            {
              message: { role: "assistant", content: "hello" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
    ]);
    const res = await new SapAiCoreProvider().chat({
      provider: "sap-ai-core",
      model: "gpt-4.1-mini",
      maxTokens: 50,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("hello");
    const inferenceCall = calls[2];
    expect(inferenceCall.url).toContain(
      "/v2/inference/deployments/dep-gpt-1/chat/completions"
    );
    const body = JSON.parse(String(inferenceCall.init?.body));
    expect(body.max_completion_tokens).toBe(50);
    expect(body.max_tokens).toBeUndefined();
  });

  it("rejects chat() against an embedding deployment with a clear error", async () => {
    mockSequence([tokenResponse, () => jsonResponse(DEPLOYMENTS)]);
    await expect(
      new SapAiCoreProvider().chat({
        provider: "sap-ai-core",
        model: "text-embedding-3-small",
        messages: [{ role: "user", content: "hi" }],
      })
    ).rejects.toThrow(/embedding deployment, not a chat model/i);
  });

  it("embeddings() routes to the embedding deployment and normalizes vectors", async () => {
    const calls = mockSequence([
      tokenResponse,
      () => jsonResponse(DEPLOYMENTS),
      () =>
        jsonResponse({
          data: [
            { index: 0, embedding: [0.1, 0.2, 0.3] },
            { index: 1, embedding: [0.4, 0.5, 0.6] },
          ],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
    ]);
    const res = await new SapAiCoreProvider().embeddings!({
      provider: "sap-ai-core",
      model: "text-embedding-3-small",
      input: ["a", "b"],
    });
    expect(res.vectors).toHaveLength(2);
    expect(res.dimensions).toBe(3);
    expect(calls[2].url).toContain(
      "/v2/inference/deployments/dep-emb-1/embeddings"
    );
  });
});
