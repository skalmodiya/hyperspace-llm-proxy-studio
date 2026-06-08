/**
 * Server-side environment loader (Zod validated).
 * Never imported by client components.
 */
import { z } from "zod";

const ServerEnvSchema = z.object({
  HYPERSPACE_PROXY_URL: z
    .string()
    .url()
    .default("http://localhost:6655"),
  HYPERSPACE_API_KEY: z.string().default(""),
  HYPERSPACE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  HYPERSPACE_RETRY_COUNT: z.coerce.number().int().min(0).default(2),
  HYPERSPACE_DEBUG: z
    .union([z.literal("true"), z.literal("false"), z.literal("")])
    .default("false")
    .transform((v) => v === "true"),

  // SAP AI Core — credentials are loaded separately (VCAP_SERVICES / file /
  // env JSON / Settings paste). Only the resource group + feature flags
  // belong here.
  AICORE_RESOURCE_GROUP: z.string().default("default"),

  // Feature flags — strings so we can accept "true"/"false"/"1"/"0".
  ENABLE_HYPERSPACE_PROVIDERS: z.string().default("true"),
  ENABLE_SAP_AI_CORE: z.string().default("true"),

  // Trim Embeddings/Models/Health from the sidebar (ON by default on BTP).
  BTP_TRIM_MODE: z.string().default("false"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail loud only at the call site; keep the message terse for logs.
    throw new Error(
      `Invalid server environment: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  cached = parsed.data;
  return cached;
}

/**
 * Allow runtime override (e.g. user changed proxy URL in Settings UI).
 * Stored in-memory on the server; resets on cold start.
 */
const overrides: Partial<ServerEnv> = {};

export function setServerEnvOverride(patch: Partial<ServerEnv>) {
  Object.assign(overrides, patch);
  cached = { ...getBase(), ...overrides };
}

function getBase(): ServerEnv {
  const parsed = ServerEnvSchema.parse(process.env);
  return parsed;
}

export function getEffectiveEnv(): ServerEnv {
  return { ...getBase(), ...overrides };
}

/** Convert "true"/"1"/"yes" to boolean. */
export function envFlag(v: string | undefined, fallback = false): boolean {
  if (!v) return fallback;
  const s = v.toLowerCase().trim();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  return fallback;
}
