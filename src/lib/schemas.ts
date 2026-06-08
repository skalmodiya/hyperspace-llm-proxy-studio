/**
 * Zod schemas for Route Handler validation.
 * Shared between client (TanStack Query callers) and server (handlers).
 */
import { z } from "zod";

export const ProviderIdSchema = z.enum([
  "anthropic",
  "openai",
  "gemini",
  "litellm",
  "sap-ai-core",
]);

export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
});

export const ChatRequestSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().min(1),
  messages: z.array(ChatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  stream: z.boolean().optional().default(false),
  systemPrompt: z.string().optional(),
});

export const EmbeddingRequestSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().min(1),
  input: z.union([z.string(), z.array(z.string())]),
  taskType: z
    .enum([
      "RETRIEVAL_QUERY",
      "RETRIEVAL_DOCUMENT",
      "SEMANTIC_SIMILARITY",
      "CLASSIFICATION",
      "CLUSTERING",
    ])
    .optional(),
  title: z.string().optional(),
});

export const SettingsPatchSchema = z.object({
  proxyUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
  retryCount: z.number().int().min(0).optional(),
  // SAP AI Core
  aiCoreResourceGroup: z.string().min(1).optional(),
  aiCoreServiceKeyJson: z.string().optional(),
  aiCoreClearOverride: z.literal(true).optional(),
});
