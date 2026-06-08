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
import { fromUnknown, jsonOk, jsonError } from "@/lib/http";
import { assertProxyUrlAndResolve, SecurityError } from "@/lib/security";
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
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Sensitive operational fields (proxy URL, AI Core apiBase, clientId
  // preview, token-cache state, retry/timeout settings) are intel for an
  // attacker. We only return them when the caller passes admin authz.
  // Non-admin callers still see flags + a boolean "configured" status so
  // the UI can render its shell and show the admin-token paste card.
  const authz = await requireAdmin(req);
  return jsonOk(buildPayload(authz.ok));
}

export async function PATCH(req: NextRequest) {
  try {
    // PATCH mutates server-side runtime config (proxy URL, API key, AI Core
    // credentials override). On BTP it must require an Admin scope; outside
    // BTP we allow it but only from loopback/dev.
    const authz = await requireAdmin(req);
    if (!authz.ok) return jsonError(authz.reason, authz.status);

    const json = await req.json();
    const parsed = SettingsPatchSchema.parse(json);

    // SSRF guard: validate the proxy URL string-side AND resolve DNS to
    // ensure no resolved IP points at a private range. AI Core service-key
    // URLs are validated inside setAiCoreOverride() via parseKey().
    if (parsed.proxyUrl !== undefined) {
      try {
        await assertProxyUrlAndResolve(parsed.proxyUrl);
      } catch (err) {
        if (err instanceof SecurityError) return jsonError(err.message, 400);
        throw err;
      }
    }

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
      // setAiCoreOverride throws if the URLs aren't on SAP hosts.
      try {
        setAiCoreOverride(parsed.aiCoreServiceKeyJson);
      } catch (err) {
        if (err instanceof SecurityError) return jsonError(err.message, 400);
        throw err;
      }
    }

    return jsonOk(buildPayload(true));
  } catch (err) {
    return fromUnknown(err);
  }
}

function buildPayload(isAdmin: boolean) {
  const env = getEffectiveEnv();
  const aiCoreCreds = tryGetCredentials();
  const status = aiCoreCreds ? tokenStatus(aiCoreCreds) : { hasToken: false, expiresInMs: null };

  // Public subset — what every caller (including the page-load that needs
  // to know whether to show the admin-token card) is allowed to see.
  const base = {
    apiKeySet: env.HYPERSPACE_API_KEY.length > 0,
    flags: {
      hyperspaceEnabled: envFlag(env.ENABLE_HYPERSPACE_PROVIDERS, true),
      sapAiCoreEnabled: envFlag(env.ENABLE_SAP_AI_CORE, true),
      btpTrimMode: envFlag(env.BTP_TRIM_MODE, false),
    },
    sapAiCore: {
      configured: aiCoreCreds !== null,
      source: aiCoreCreds?.source ?? "none",
    },
  };

  if (!isAdmin) {
    // Mask everything else — return placeholders so the UI types still match.
    return {
      ...base,
      proxyUrl: "***",
      requestTimeoutMs: 0,
      retryCount: 0,
      debug: false,
      sapAiCore: {
        ...base.sapAiCore,
        apiBase: null,
        resourceGroup: "***",
        clientIdPreview: null,
        tokenCached: false,
        tokenExpiresInMs: null,
      },
      authz: { isAdmin: false },
    };
  }

  return {
    ...base,
    proxyUrl: env.HYPERSPACE_PROXY_URL,
    requestTimeoutMs: env.HYPERSPACE_REQUEST_TIMEOUT_MS,
    retryCount: env.HYPERSPACE_RETRY_COUNT,
    debug: env.HYPERSPACE_DEBUG,
    sapAiCore: {
      ...base.sapAiCore,
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
    authz: { isAdmin: true },
  };
}
