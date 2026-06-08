/**
 * SAP AI Core credentials discovery.
 *
 * Sources, in priority order (first wins):
 *   1. VCAP_SERVICES.aicore[*].credentials   (Cloud Foundry binding)
 *   2. File at AICORE_SERVICE_KEY_PATH       (Kyma Secret mount, local file)
 *   3. JSON in AICORE_SERVICE_KEY_JSON       (env-pasted JSON, last resort)
 *   4. setRuntimeOverride()                  (Settings UI paste, in-memory only)
 *
 * The shape of an AI Core service key is the same in all four sources, so
 * one parser handles everything. The shape was confirmed against a live
 * service key on 2026-06-08.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

const RawKeySchema = z.object({
  serviceurls: z.object({
    AI_API_URL: z.string().url(),
  }),
  clientid: z.string().min(1),
  clientsecret: z.string().min(1),
  url: z.string().url(),
  appname: z.string().optional(),
  identityzone: z.string().optional(),
  identityzoneid: z.string().optional(),
  "credential-type": z.string().optional(),
  "token-type": z.array(z.string()).optional(),
});

export type RawKey = z.infer<typeof RawKeySchema>;

export type CredentialSource =
  | "vcap-services"
  | "file"
  | "env-json"
  | "settings-ui"
  | "none";

export interface AiCoreCredentials {
  apiBase: string; // e.g. https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com
  clientId: string;
  clientSecret: string;
  tokenUrl: string; // XSUAA base, /oauth/token gets appended at request time
  source: CredentialSource;
  /** Stable cache key (clientId hash works fine — collisions are impossible across SAP). */
  fingerprint: string;
}

let runtimeOverride: AiCoreCredentials | null = null;

export function setRuntimeOverride(json: string): AiCoreCredentials {
  const creds = parseKey(JSON.parse(json), "settings-ui");
  runtimeOverride = creds;
  return creds;
}

export function clearRuntimeOverride() {
  runtimeOverride = null;
}

/**
 * Reset the discovery cache. Tests use this; production code does not need it
 * (cache TTL takes care of refresh).
 */
export function _resetCredentialsCache() {
  cached = { creds: null, readAt: 0 };
  runtimeOverride = null;
}

/**
 * Resolve credentials. Throws ProviderError-like Error if none found.
 * Cached at module scope is intentional: in production each instance lives
 * in its own process so a one-time discovery is safe.
 */
let cached: { creds: AiCoreCredentials | null; readAt: number } = {
  creds: null,
  readAt: 0,
};
const CACHE_TTL_MS = 60_000;

export function getCredentials(): AiCoreCredentials {
  if (runtimeOverride) return runtimeOverride;
  const now = Date.now();
  if (cached.creds && now - cached.readAt < CACHE_TTL_MS) return cached.creds;

  const creds = discover();
  if (!creds) {
    throw new Error(
      "SAP AI Core credentials not configured. " +
        "Provide via VCAP_SERVICES (CF binding), AICORE_SERVICE_KEY_PATH (file), " +
        "AICORE_SERVICE_KEY_JSON (env), or paste in Settings UI."
    );
  }
  cached = { creds, readAt: now };
  return creds;
}

export function tryGetCredentials(): AiCoreCredentials | null {
  try {
    return getCredentials();
  } catch {
    return null;
  }
}

function discover(): AiCoreCredentials | null {
  // 1. VCAP_SERVICES (CF binding)
  const vcap = process.env.VCAP_SERVICES;
  if (vcap) {
    try {
      const parsed = JSON.parse(vcap) as Record<string, Array<{ credentials?: unknown }>>;
      // The service offering name is "aicore" in SAP BTP marketplace.
      const aicore = parsed.aicore?.[0]?.credentials;
      if (aicore) return parseKey(aicore, "vcap-services");
    } catch {
      /* fall through to the next source */
    }
  }

  // 2. Mounted file (Kyma Secret, local file)
  const path = process.env.AICORE_SERVICE_KEY_PATH;
  if (path) {
    try {
      const text = readFileSync(path, "utf8");
      return parseKey(JSON.parse(text), "file");
    } catch {
      /* fall through */
    }
  }

  // 3. Pasted JSON in env
  const json = process.env.AICORE_SERVICE_KEY_JSON;
  if (json) {
    try {
      return parseKey(JSON.parse(json), "env-json");
    } catch {
      /* fall through */
    }
  }

  return null;
}

function parseKey(raw: unknown, source: CredentialSource): AiCoreCredentials {
  const parsed = RawKeySchema.parse(raw);
  return {
    apiBase: parsed.serviceurls.AI_API_URL.replace(/\/$/, ""),
    clientId: parsed.clientid,
    clientSecret: parsed.clientsecret,
    tokenUrl: parsed.url.replace(/\/$/, ""),
    source,
    fingerprint: hashFingerprint(parsed.clientid),
  };
}

/** Cheap, deterministic, non-cryptographic — only used as a cache key. */
function hashFingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
