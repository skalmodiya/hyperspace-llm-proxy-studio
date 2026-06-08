import { describe, it, expect } from "vitest";
import {
  ChatRequestSchema,
  EmbeddingRequestSchema,
  SettingsPatchSchema,
} from "@/lib/schemas";

describe("schemas", () => {
  it("ChatRequest validates a minimal request", () => {
    const parsed = ChatRequestSchema.parse({
      provider: "openai",
      model: "gpt-5",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(parsed.stream).toBe(false);
  });

  it("ChatRequest rejects empty messages", () => {
    expect(() =>
      ChatRequestSchema.parse({
        provider: "openai",
        model: "gpt-5",
        messages: [],
      })
    ).toThrow();
  });

  it("EmbeddingRequest accepts string and array input", () => {
    expect(() =>
      EmbeddingRequestSchema.parse({
        provider: "openai",
        model: "x",
        input: "hello",
      })
    ).not.toThrow();

    expect(() =>
      EmbeddingRequestSchema.parse({
        provider: "openai",
        model: "x",
        input: ["a", "b"],
      })
    ).not.toThrow();
  });

  it("SettingsPatch validates URLs", () => {
    expect(() =>
      SettingsPatchSchema.parse({ proxyUrl: "not-a-url" })
    ).toThrow();

    expect(() =>
      SettingsPatchSchema.parse({
        proxyUrl: "http://proxy.test",
        retryCount: 3,
      })
    ).not.toThrow();
  });
});
