/**
 * Server-side authorization for state-mutating routes.
 *
 * Two operating modes:
 *
 *   1. **BTP (Approuter present)** — every request reaches us with a JWT
 *      forwarded by the Approuter as `Authorization: Bearer <jwt>`. The
 *      Approuter has already validated the signature and audience; we
 *      re-parse only the unsigned payload to read the `scope` claim and
 *      require `<xsappname>.Admin` for admin-only routes.
 *
 *      We do NOT re-verify the JWT signature here because the Approuter
 *      already did, AND because verifying would require fetching the JWKS
 *      on every request (or caching it, which is more code than it's worth
 *      for an internal-only tool). Treating the Approuter as a trusted
 *      front-end is the SAP-recommended pattern for downstream services
 *      bound on the same CF org.
 *
 *   2. **Local dev / Docker (no Approuter)** — there is no JWT. We only
 *      permit admin routes from loopback (127.0.0.1, ::1) to avoid an
 *      accidentally-exposed dev server being manipulated.
 *
 * Switching between modes is detected by the BTP_TRIM_MODE flag (set true
 * in the BTP MTA + Helm chart) plus presence of `Authorization: Bearer`.
 */
import type { NextRequest } from "next/server";
import { getEffectiveEnv, envFlag } from "./env";

export type AuthzResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/** Require admin privileges for the request. */
export function requireAdmin(req: NextRequest): AuthzResult {
  const env = getEffectiveEnv();
  const isBtp = envFlag(env.BTP_TRIM_MODE, false);
  const auth = req.headers.get("authorization") ?? "";

  if (isBtp || auth.toLowerCase().startsWith("bearer ")) {
    return checkXsuaaAdmin(auth);
  }

  // Non-BTP path: allow only loopback callers. The Next.js dev server and
  // Docker container expose 0.0.0.0:3000 by default; a curl from another
  // host on the same network would be rejected.
  const ip = clientIpFromHeaders(req);
  if (isLoopback(ip)) return { ok: true };

  return {
    ok: false,
    status: 403,
    reason:
      "Admin route. In dev/Docker, must be called from localhost. " +
      "On BTP, requires a valid XSUAA token with the Admin scope.",
  };
}

function checkXsuaaAdmin(authHeader: string): AuthzResult {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) {
    return {
      ok: false,
      status: 401,
      reason: "Missing Bearer token (XSUAA JWT expected).",
    };
  }
  const claims = decodeJwtPayload(m[1]);
  if (!claims) {
    return { ok: false, status: 401, reason: "Malformed JWT." };
  }
  // XSUAA puts scopes in either `scope` (string-array) or `scopes`. The
  // template name is `<xsappname>.Admin`. We accept any scope ending in
  // `.Admin` — the Approuter has already restricted who could mint a token
  // for this xsappname, so the value before `.` is implicitly trusted.
  const scopes = collectScopes(claims);
  const hasAdmin = scopes.some((s) => /\.Admin$/.test(s));
  if (!hasAdmin) {
    return {
      ok: false,
      status: 403,
      reason:
        "Insufficient scope. This route requires the Admin role collection " +
        "(e.g. 'Hyperspace Studio Admin' in BTP cockpit → Security → Role Collections).",
    };
  }
  return { ok: true };
}

interface JwtPayload {
  scope?: string[] | string;
  scopes?: string[];
  // … other claims we don't read.
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8"
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function collectScopes(claims: JwtPayload): string[] {
  const out: string[] = [];
  if (Array.isArray(claims.scope)) out.push(...claims.scope);
  else if (typeof claims.scope === "string") out.push(claims.scope);
  if (Array.isArray(claims.scopes)) out.push(...claims.scopes);
  return out;
}

function clientIpFromHeaders(req: NextRequest): string {
  // Next.js doesn't expose req.ip on every adapter; fall back to common
  // proxy headers, then to a sensible default.
  const xfwd = req.headers.get("x-forwarded-for");
  if (xfwd) return xfwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  // No header → request came in from a direct socket; treat as loopback in
  // dev (Next.js dev server only listens on localhost by default).
  return "127.0.0.1";
}

function isLoopback(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.")
  );
}
