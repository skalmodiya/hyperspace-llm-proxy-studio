import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { OpenAIProvider } from "../openai";
import { AnthropicProvider } from "../anthropic";
import { GeminiProvider } from "../gemini";
import { LiteLLMProvider } from "../litellm";

// All providers share the same shape for the request layer; we mock fetch and
// assert that each adapter (a) hits the right path, (b) sends the right body,
// (c) maps the upstream payload into our normalized shape.

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.HYPERSPACE_PROXY_URL = "http://proxy.test";
  process.env.HYPERSPACE_API_KEY = "test-key";
  process.env.HYPERSPACE_REQUEST_TIMEOUT_MS = "5000";
  process.env.HYPERSPACE_RETRY_COUNT = "0";
  process.env.HYPERSPACE_DEBUG = "false";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("OpenAIProvider", () => {
  it("listModels uses /openai/v1/models and includes Bearer token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://proxy.test/openai/v1/models");
      expect(
        (init?.headers as Record<string, string>).Authorization
      ).toBe("Bearer test-key");
      return mockJsonResponse({
        data: [
          { id: "gpt-5", owned_by: "openai" },
          { id: "text-embedding-3-small", owned_by: "openai" },
        ],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const models = await new OpenAIProvider().listModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({
      id: "gpt-5",
      provider: "openai",
      type: "chat",
    });
    expect(models[1].type).toBe("embedding");
  });

  it("chat() shapes the response and includes system prompt", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("http://proxy.test/openai/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-5");
      expect(body.messages[0]).toMatchObject({
        role: "system",
        content: "be terse",
      });
      return mockJsonResponse({
        id: "chatcmpl-1",
        model: "gpt-5",
        choices: [
          { message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await new OpenAIProvider().chat({
      provider: "openai",
      model: "gpt-5",
      systemPrompt: "be terse",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(res.content).toBe("ok");
    expect(res.usage?.totalTokens).toBe(5);
    expect(res.finishReason).toBe("stop");
  });

  it("uses max_completion_tokens for GPT-5 family, max_tokens otherwise", async () => {
    const seenBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      seenBodies.push(JSON.parse(String(init?.body)));
      return mockJsonResponse({
        id: "1",
        model: "x",
        choices: [
          {
            message: { role: "assistant", content: "" },
            finish_reason: "stop",
          },
        ],
      });
    }) as unknown as typeof fetch;

    const p = new OpenAIProvider();
    await p.chat({
      provider: "openai",
      model: "gpt-5-mini",
      maxTokens: 50,
      messages: [{ role: "user", content: "hi" }],
    });
    await p.chat({
      provider: "openai",
      model: "gpt-3.5-turbo",
      maxTokens: 50,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(seenBodies[0]).toMatchObject({ max_completion_tokens: 50 });
    expect(seenBodies[0]).not.toHaveProperty("max_tokens");
    expect(seenBodies[1]).toMatchObject({ max_tokens: 50 });
    expect(seenBodies[1]).not.toHaveProperty("max_completion_tokens");
  });

  it("embeddings() returns normalized vectors", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockJsonResponse({
        model: "text-embedding-3-small",
        data: [
          { index: 0, embedding: [0.1, 0.2, 0.3] },
          { index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      })
    ) as unknown as typeof fetch;

    const res = await new OpenAIProvider().embeddings!({
      provider: "openai",
      model: "text-embedding-3-small",
      input: ["hello", "world"],
    });
    expect(res.vectors).toHaveLength(2);
    expect(res.dimensions).toBe(3);
  });
});

describe("AnthropicProvider", () => {
  it("uses /anthropic/v1/messages and concatenates content blocks", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(url).toBe("http://proxy.test/anthropic/v1/messages");
      return mockJsonResponse({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "anthropic--claude-4.6-sonnet",
        content: [
          { type: "text", text: "hel" },
          { type: "text", text: "lo" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 2 },
      });
    }) as unknown as typeof fetch;

    const res = await new AnthropicProvider().chat({
      provider: "anthropic",
      model: "anthropic--claude-4.6-sonnet",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("hello");
    expect(res.usage?.totalTokens).toBe(7);
  });

  it("falls back to a hardcoded list when /models fails", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 500 })
    ) as unknown as typeof fetch;
    const models = await new AnthropicProvider().listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].provider).toBe("anthropic");
  });
});

describe("GeminiProvider", () => {
  it("uses :generateContent path and translates roles", async () => {
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "http://proxy.test/gemini/v1beta/models/gemini-2.5-flash:generateContent"
      );
      const body = JSON.parse(String(init?.body));
      expect(body.contents[0].role).toBe("user");
      expect(body.systemInstruction.parts[0].text).toBe("be helpful");
      return mockJsonResponse({
        candidates: [
          {
            content: { parts: [{ text: "ok!" }], role: "model" },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 2,
          totalTokenCount: 5,
        },
      });
    }) as unknown as typeof fetch;

    const res = await new GeminiProvider().chat({
      provider: "gemini",
      model: "gemini-2.5-flash",
      systemPrompt: "be helpful",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("ok!");
    expect(res.usage?.totalTokens).toBe(5);
  });
});

describe("LiteLLMProvider", () => {
  it("preserves Perplexity citations from message.extensions on chat", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockJsonResponse({
        id: "1",
        model: "sonar",
        choices: [
          {
            message: {
              role: "assistant",
              content: "answer",
              extensions: {
                citations: [
                  { ref_id: 1, url: "https://example.com/a", title: "A" },
                  { ref_id: 2, url: "https://example.com/b", title: "B" },
                ],
              },
            },
            finish_reason: "stop",
          },
        ],
      })
    ) as unknown as typeof fetch;

    const res = await new LiteLLMProvider().chat({
      provider: "litellm",
      model: "sonar",
      messages: [{ role: "user", content: "?" }],
    });
    expect(res.citations).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("falls back to top-level citations array (string form)", async () => {
    globalThis.fetch = vi.fn(async () =>
      mockJsonResponse({
        id: "1",
        model: "sonar",
        choices: [
          {
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        citations: ["https://x.test/1", "https://x.test/2"],
      })
    ) as unknown as typeof fetch;

    const res = await new LiteLLMProvider().chat({
      provider: "litellm",
      model: "sonar",
      messages: [{ role: "user", content: "?" }],
    });
    expect(res.citations).toEqual(["https://x.test/1", "https://x.test/2"]);
  });
});
