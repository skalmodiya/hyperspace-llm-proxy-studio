/**
 * XSUAA OAuth2 client-credentials token cache.
 *
 * AI Core requires a fresh JWT bearer token for every API call. We fetch one
 * per credentials fingerprint, cache it in memory, and refresh ~60s before
 * the upstream-reported expiry.
 *
 * Each Cloud Foundry / Kyma replica has its own cache. At small scale this is
 * fine; if you scale past ~3 replicas, swap to a shared store (Redis on the
 * BTP marketplace).
 */
import { getCredentials, type AiCoreCredentials } from "./credentials";

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
  fetchedAtMs: number;
}

interface XsuaaTokenResponse {
  access_token: string;
  expires_in: number; // seconds
  token_type?: string;
  scope?: string;
}

/** Refresh this many milliseconds before the upstream expiry. */
const REFRESH_LEEWAY_MS = 60_000;

const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

export async function getAccessToken(
  creds: AiCoreCredentials = getCredentials()
): Promise<string> {
  const key = creds.fingerprint;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAtMs - REFRESH_LEEWAY_MS) {
    return cached.accessToken;
  }
  // Single-flight: if a concurrent caller is already fetching, await theirs.
  const pending = inflight.get(key);
  if (pending) return (await pending).accessToken;

  const promise = fetchToken(creds).then((token) => {
    cache.set(key, token);
    inflight.delete(key);
    return token;
  });
  promise.catch(() => inflight.delete(key));
  inflight.set(key, promise);
  return (await promise).accessToken;
}

export function clearTokenCache() {
  cache.clear();
  inflight.clear();
}

export function tokenStatus(
  creds: AiCoreCredentials = getCredentials()
): { hasToken: boolean; expiresInMs: number | null } {
  const t = cache.get(creds.fingerprint);
  if (!t) return { hasToken: false, expiresInMs: null };
  return {
    hasToken: true,
    expiresInMs: Math.max(0, t.expiresAtMs - Date.now()),
  };
}

async function fetchToken(creds: AiCoreCredentials): Promise<CachedToken> {
  const url = `${creds.tokenUrl}/oauth/token`;
  // Standard XSUAA client-credentials request; basic-auth with id+secret.
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(
    `${creds.clientId}:${creds.clientSecret}`,
    "utf8"
  ).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `XSUAA token endpoint returned ${res.status}: ${text.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as XsuaaTokenResponse;
  if (!json.access_token || !json.expires_in) {
    throw new Error("XSUAA token response missing access_token or expires_in");
  }
  return {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + json.expires_in * 1000,
    fetchedAtMs: Date.now(),
  };
}
