/**
 * Server-side URL safety helpers — guard against SSRF and credential
 * redirection.
 *
 * Two distinct concerns:
 *   1. SAP AI Core endpoints MUST be on SAP-controlled domains. Otherwise an
 *      attacker who controls a service-key paste can redirect token exchange
 *      to their own server, capturing the bearer token.
 *   2. The Hyperspace proxy URL is user-configurable but must not target
 *      cloud-internal metadata endpoints (169.254.169.254), localhost, or
 *      RFC1918 ranges from production. Allowed in dev only.
 */

const SAP_AICORE_API_HOST_SUFFIXES = [
  // Production AI Core API hosts — covers AWS, Azure, GCP regions.
  ".ml.hana.ondemand.com",
  ".ai.cloud.sap",
  ".aicore.cfapps.sap.hana.ondemand.com",
];

const SAP_AUTH_HOST_SUFFIXES = [
  // XSUAA token endpoints — every BTP subaccount uses this pattern.
  ".authentication.sap.hana.ondemand.com",
  ".authentication.eu10.hana.ondemand.com",
  ".authentication.eu20.hana.ondemand.com",
  ".authentication.us10.hana.ondemand.com",
  ".authentication.us20.hana.ondemand.com",
  ".authentication.us30.hana.ondemand.com",
  ".authentication.ap10.hana.ondemand.com",
  ".authentication.ap11.hana.ondemand.com",
  ".authentication.ap20.hana.ondemand.com",
  ".authentication.ap21.hana.ondemand.com",
  ".authentication.jp10.hana.ondemand.com",
  ".authentication.jp20.hana.ondemand.com",
  ".authentication.ca10.hana.ondemand.com",
  ".authentication.br10.hana.ondemand.com",
  ".authentication.br20.hana.ondemand.com",
  // Catch-all — every BTP region follows ".authentication.<region>.hana.ondemand.com".
  ".hana.ondemand.com",
];

/** Throws if `url` is not a valid SAP AI Core API URL. */
export function assertAiCoreApiUrl(url: string): URL {
  const parsed = parseStrictHttps(url, "AI Core API URL");
  if (!matchesSuffix(parsed.hostname, SAP_AICORE_API_HOST_SUFFIXES)) {
    throw new SecurityError(
      `Refusing to use AI Core API URL with host "${parsed.hostname}". ` +
        `Expected an SAP-controlled host (e.g. *.ml.hana.ondemand.com). ` +
        `If your tenant uses a different host, add its suffix to ` +
        `SAP_AICORE_API_HOST_SUFFIXES in src/lib/security.ts.`
    );
  }
  return parsed;
}

/** Throws if `url` is not a valid SAP XSUAA token URL. */
export function assertXsuaaTokenUrl(url: string): URL {
  const parsed = parseStrictHttps(url, "XSUAA token URL");
  if (!matchesSuffix(parsed.hostname, SAP_AUTH_HOST_SUFFIXES)) {
    throw new SecurityError(
      `Refusing to use XSUAA token URL with host "${parsed.hostname}". ` +
        `Expected an SAP authentication host (*.authentication.<region>.hana.ondemand.com).`
    );
  }
  return parsed;
}

/**
 * Validate a Hyperspace-proxy-style URL provided by the user via PATCH
 * /api/settings. In production we reject private IP ranges + cloud metadata
 * endpoints to prevent SSRF. In dev (NODE_ENV !== "production") we allow
 * localhost so `http://localhost:6655` continues to work.
 */
export function assertProxyUrl(url: string): URL {
  const parsed = parseHttpOrHttps(url, "proxy URL");
  if (process.env.NODE_ENV === "production" && isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new SecurityError(
      `Refusing to use proxy URL "${parsed.hostname}" in production. ` +
        `Private, loopback, link-local, and cloud-metadata addresses are blocked.`
    );
  }
  // Always block AWS / Azure / GCP instance-metadata endpoints, even in dev —
  // there's no legitimate use case from inside this app.
  if (parsed.hostname === "169.254.169.254" || parsed.hostname === "metadata.google.internal") {
    throw new SecurityError(
      `Refusing to use cloud instance-metadata endpoint as proxy URL.`
    );
  }
  return parsed;
}

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

// ---- helpers ---------------------------------------------------------------

function parseStrictHttps(url: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SecurityError(`Invalid ${label}: "${url}"`);
  }
  if (parsed.protocol !== "https:") {
    throw new SecurityError(`${label} must use https; got "${parsed.protocol}"`);
  }
  return parsed;
}

function parseHttpOrHttps(url: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SecurityError(`Invalid ${label}: "${url}"`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SecurityError(
      `${label} must use http or https; got "${parsed.protocol}"`
    );
  }
  return parsed;
}

function matchesSuffix(hostname: string, suffixes: string[]): boolean {
  const h = hostname.toLowerCase();
  return suffixes.some((s) => h === s.replace(/^\./, "") || h.endsWith(s));
}

/**
 * String-only check (no DNS) — covers the common SSRF cases without making
 * the validation flaky behind a DNS hijack. For full defense the runtime
 * should also enforce egress firewall rules at the platform layer.
 */
function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv4 literals
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^0\./.test(h)) return true;
  // IPv6 loopback + link-local + ULA
  if (h === "::1" || h === "[::1]") return true;
  if (h.startsWith("fe80:") || h.startsWith("[fe80:")) return true;
  if (h.startsWith("fc") || h.startsWith("[fc") || h.startsWith("fd") || h.startsWith("[fd")) {
    return true;
  }
  return false;
}
