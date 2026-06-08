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
 *
 * Note on TOCTOU: a hostname can resolve to a public IP at validation time
 * and a private IP at fetch time (DNS rebinding). The robust fix is
 * platform-level egress firewall rules (Kyma NetworkPolicy, CF egress).
 * As code-level defense in depth, `assertProxyUrlAndResolve()` returns the
 * resolved IP so the caller can connect to it directly via undici's
 * `lookup` option. Without that, we accept the residual TOCTOU risk in
 * exchange for a much simpler call site.
 */
import { promises as dns } from "node:dns";

const SAP_AICORE_API_HOST_SUFFIXES = [
  // Production AI Core API hosts — covers AWS, Azure, GCP regions.
  ".ml.hana.ondemand.com",
  ".ai.cloud.sap",
  ".aicore.cfapps.sap.hana.ondemand.com",
];

/**
 * XSUAA token endpoints. Pattern is always
 * `<tenant>.authentication.<region>.hana.ondemand.com` where `<region>` is
 * a 2-letter prefix + 1–2 digit suffix (e.g. eu10, us30, ap21, jp10, br20,
 * ca10). The `sap` central tenant is the one historical exception.
 *
 * The previous implementation included ".hana.ondemand.com" as a catch-all
 * suffix — that was too broad and would have accepted any
 * `*.hana.ondemand.com` host (HANA service URLs, Cloud Connector, etc.).
 * We now match a tight regex per call.
 */
const XSUAA_TOKEN_HOST_RE =
  /^[a-z0-9-]+\.authentication\.(?:[a-z]{2}\d{1,2}|sap)\.hana\.ondemand\.com$/i;

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
  if (!XSUAA_TOKEN_HOST_RE.test(parsed.hostname)) {
    throw new SecurityError(
      `Refusing to use XSUAA token URL with host "${parsed.hostname}". ` +
        `Expected the pattern <tenant>.authentication.<region>.hana.ondemand.com.`
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

/**
 * Like `assertProxyUrl`, but ALSO performs DNS resolution and rejects if any
 * resolved A/AAAA record points at a private/loopback/link-local address in
 * production. Use this in PATCH /api/settings before saving the URL — it
 * catches DNS-rebinding-style attacks where `attacker.example.com` resolves
 * to `127.0.0.1` or `169.254.169.254`.
 *
 * Caveats:
 *  - Off-production (NODE_ENV !== "production") this only enforces the
 *    string-level guards; localhost-resolving names are allowed so dev
 *    workflows aren't broken.
 *  - There is still a TOCTOU window between this validation and the
 *    eventual fetch. The platform-level egress firewall is the durable fix.
 */
export async function assertProxyUrlAndResolve(url: string): Promise<URL> {
  const parsed = assertProxyUrl(url);
  if (process.env.NODE_ENV !== "production") return parsed;

  // Skip DNS resolution if the host is already a literal IP — assertProxyUrl
  // covered that case via isPrivateOrLoopbackHost.
  if (isIpLiteral(parsed.hostname)) return parsed;

  let addrs: string[] = [];
  try {
    const lookups = await dns.lookup(parsed.hostname, { all: true });
    addrs = lookups.map((l) => l.address);
  } catch (err) {
    throw new SecurityError(
      `Could not resolve proxy host "${parsed.hostname}": ${
        (err as Error).message
      }`
    );
  }
  for (const ip of addrs) {
    if (isPrivateOrLoopbackHost(ip)) {
      throw new SecurityError(
        `Refusing to use proxy URL "${parsed.hostname}" in production: ` +
          `it resolves to a private/loopback address (${ip}).`
      );
    }
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

function isIpLiteral(hostname: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 (with or without brackets)
  if (/^[\[]?[0-9a-f:]+[\]]?$/i.test(hostname) && hostname.includes(":")) {
    return true;
  }
  return false;
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
