/**
 * GET /api/settings  — return current effective server config (redacted).
 * PATCH /api/settings — update runtime overrides.
 *
 * AI Core credentials are NEVER returned to the client — only a
 * `{ source, configured, tokenExpiresInMs, resourceGroup }` summary.
 */
import { NextRequest } from "next/server";
import {
  envFlag,
  getEffectiveEnv,
  setServerEnvOverride,
} from "@/lib/env";
import { SettingsPatchSchema } from "@/lib/schemas";
import { fromUnknown, jsonOk } from "@/lib/http";
import {
  setRuntimeOverride as setAiCoreOverride,
  clearRuntimeOverride as clearAiCoreOverride,
  tryGetCredentials,
} from "@/lib/providers/sap-ai-core/credentials";
import {
  setResourceGroup,
  getResourceGroup,
} from "@/lib/providers/sap-ai-core";
import { tokenStatus } from "@/lib/providers/sap-ai-core/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return jsonOk(buildPayload());
}

export async function PATCH(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = SettingsPatchSchema.parse(json);

    setServerEnvOverride({
      ...(parsed.proxyUrl !== undefined
        ? { HYPERSPACE_PROXY_URL: parsed.proxyUrl }
        : {}),
      ...(parsed.apiKey !== undefined
        ? { HYPERSPACE_API_KEY: parsed.apiKey }
        : {}),
      ...(parsed.requestTimeoutMs !== undefined
        ? { HYPERSPACE_REQUEST_TIMEOUT_MS: parsed.requestTimeoutMs }
        : {}),
      ...(parsed.retryCount !== undefined
        ? { HYPERSPACE_RETRY_COUNT: parsed.retryCount }
        : {}),
    });

    if (parsed.aiCoreResourceGroup !== undefined) {
      setResourceGroup(parsed.aiCoreResourceGroup);
    }
    if (parsed.aiCoreClearOverride) {
      clearAiCoreOverride();
    } else if (parsed.aiCoreServiceKeyJson) {
      setAiCoreOverride(parsed.aiCoreServiceKeyJson);
    }

    return jsonOk(buildPayload());
  } catch (err) {
    return fromUnknown(err);
  }
}

function buildPayload() {
  const env = getEffectiveEnv();
  const aiCoreCreds = tryGetCredentials();
  const status = aiCoreCreds ? tokenStatus(aiCoreCreds) : { hasToken: false, expiresInMs: null };

  return {
    proxyUrl: env.HYPERSPACE_PROXY_URL,
    apiKeySet: env.HYPERSPACE_API_KEY.length > 0,
    requestTimeoutMs: env.HYPERSPACE_REQUEST_TIMEOUT_MS,
    retryCount: env.HYPERSPACE_RETRY_COUNT,
    debug: env.HYPERSPACE_DEBUG,
    flags: {
      hyperspaceEnabled: envFlag(env.ENABLE_HYPERSPACE_PROVIDERS, true),
      sapAiCoreEnabled: envFlag(env.ENABLE_SAP_AI_CORE, true),
      btpTrimMode: envFlag(env.BTP_TRIM_MODE, false),
    },
    sapAiCore: {
      configured: aiCoreCreds !== null,
      // Where the credentials came from. Never returns secrets.
      source: aiCoreCreds?.source ?? "none",
      apiBase: aiCoreCreds?.apiBase ?? null,
      resourceGroup: getResourceGroup(),
      // Only the first 8 chars of the clientId — enough to confirm "this is the
      // right tenant" without leaking the full id.
      clientIdPreview: aiCoreCreds
        ? aiCoreCreds.clientId.slice(0, 8) + "…"
        : null,
      tokenCached: status.hasToken,
      tokenExpiresInMs: status.expiresInMs,
    },
  };
}
