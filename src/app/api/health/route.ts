/**
 * GET /api/health — proxy connectivity + provider availability.
 */
import { NextRequest } from "next/server";
import { getEffectiveEnv } from "@/lib/env";
import { listProviderIds, getProvider } from "@/lib/providers";
import { jsonOk } from "@/lib/http";
import { assertProxyUrl, SecurityError } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const env = getEffectiveEnv();
  const start = Date.now();

  let proxyReachable = false;
  let proxyStatus: number | null = null;
  let proxyError: string | null = null;
  // SSRF defense: validate the proxy URL before fetching it. If the URL
  // points at a private/loopback host in production, refuse to probe at all
  // — it's safer to surface "blocked" than to give an attacker a working
  // ping primitive against the cloud-internal network.
  try {
    assertProxyUrl(env.HYPERSPACE_PROXY_URL);
    const res = await fetch(env.HYPERSPACE_PROXY_URL, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
      // Don't follow cross-host redirects — that's another SSRF gadget.
      redirect: "manual",
    });
    proxyReachable = true;
    proxyStatus = res.status;
  } catch (err) {
    proxyReachable = false;
    if (err instanceof SecurityError) proxyError = err.message;
  }

  // Probe each provider with a lightweight listModels() call. Failures are silent.
  const probes = await Promise.all(
    listProviderIds().map(async (id) => {
      try {
        const t0 = Date.now();
        const models = await getProvider(id).listModels();
        return {
          provider: id,
          ok: true,
          modelCount: models.length,
          latencyMs: Date.now() - t0,
        };
      } catch (err) {
        return {
          provider: id,
          ok: false,
          error: err instanceof Error ? err.message : "unknown",
        };
      }
    })
  );

  return jsonOk({
    proxy: {
      url: env.HYPERSPACE_PROXY_URL,
      reachable: proxyReachable,
      status: proxyStatus,
      ...(proxyError ? { error: proxyError } : {}),
    },
    providers: probes,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  });
}
