/**
 * Server-side authorization for state-mutating routes.
 *
 * Two operating modes — chosen explicitly by BTP_TRIM_MODE, never by the
 * presence of a header on the incoming request (which an attacker could
 * forge):
 *
 *   1. **BTP mode** (BTP_TRIM_MODE=true) — every request reaches us with a
 *      JWT forwarded by the Approuter as `Authorization: Bearer <jwt>`.
 *      We verify the JWT against the bound XSUAA service using the official
 *      `@sap/xssec` library: signature + issuer + audience + exp + scopes.
 *      The token is only trusted after `securityContext.checkLocalScope()`
 *      passes for `Admin`.
 *
 *      We do not trust an `Authorization` header in non-BTP mode — that's
 *      the auth-bypass the previous version had. In non-BTP mode we ignore
 *      headers entirely.
 *
 *   2. **Local dev / Docker** (BTP_TRIM_MODE not set / false) — there is no
 *      XSUAA binding and no Approuter. We require the request to come from
 *      a loopback socket peer. The peer is read from the actual TCP
 *      connection (`request.ip` on the runtime, or the underlying socket),
 *      NEVER from `X-Forwarded-For` / `X-Real-IP` headers (those are
 *      spoofable from any client).
 */
import type { NextRequest } from "next/server";
import { envFlag, getEffectiveEnv } from "./env";

export type AuthzResult =
  | { ok: true; subject?: string }
  | { ok: false; status: number; reason: string };

/** Require admin privileges for the request. */
export async function requireAdmin(req: NextRequest): Promise<AuthzResult> {
  const env = getEffectiveEnv();
  const isBtp = envFlag(env.BTP_TRIM_MODE, false);

  if (isBtp) {
    return await verifyXsuaaAdmin(req);
  }

  // Local / Docker — only loopback callers may mutate runtime config.
  // Read the peer from the actual socket, not from headers.
  const peer = trustedPeerIp(req);
  if (peer === null) {
    return {
      ok: false,
      status: 403,
      reason:
        "Unable to determine client peer address; refusing admin access. " +
        "If this is BTP, set BTP_TRIM_MODE=true so the XSUAA path is used instead.",
    };
  }
  if (!isLoopback(peer)) {
    return {
      ok: false,
      status: 403,
      reason:
        `Admin route. In dev/Docker, only loopback callers (127.0.0.1, ::1) ` +
        `may mutate runtime config; got ${peer}.`,
    };
  }
  return { ok: true, subject: `loopback:${peer}` };
}

/**
 * Verify the bearer JWT on a BTP request via @sap/xssec.
 *
 * Lazy-loaded so the package isn't a hard requirement off-BTP. The XSUAA
 * binding (clientid, clientsecret, url, xsappname) is read from
 * VCAP_SERVICES in production. The library handles JWKS fetch + caching.
 */
async function verifyXsuaaAdmin(req: NextRequest): Promise<AuthzResult> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    return { ok: false, status: 401, reason: "Missing Bearer token." };
  }
  const token = m[1];

  let xssec: typeof import("@sap/xssec");
  try {
    xssec = await import("@sap/xssec");
  } catch {
    return {
      ok: false,
      status: 500,
      reason: "Auth subsystem missing (@sap/xssec). This is a deployment bug.",
    };
  }

  const xsuaaCreds = readXsuaaCredentialsFromVcap();
  if (!xsuaaCreds) {
    return {
      ok: false,
      status: 500,
      reason:
        "BTP_TRIM_MODE is on but no XSUAA binding was found in VCAP_SERVICES. " +
        "Bind the studio module to an xsuaa service instance and redeploy.",
    };
  }

  // @sap/xssec v4 exposes `createSecurityContext` for token validation.
  // The promise resolves with a SecurityContext on success; rejects on bad
  // signature, expired exp, wrong audience, etc.
  const ctx = await new Promise<unknown>((resolve, reject) => {
    // The shape of `createSecurityContext` varies slightly by version; we
    // fall back to the callback form which all 4.x releases support.
    const fn = (xssec as unknown as {
      createSecurityContext?: (
        token: string,
        creds: unknown,
        cb: (err: unknown, sc: unknown) => void
      ) => void;
    }).createSecurityContext;
    if (!fn) {
      reject(new Error("@sap/xssec.createSecurityContext not available"));
      return;
    }
    fn(token, xsuaaCreds, (err, sc) => (err ? reject(err) : resolve(sc)));
  }).catch((err: Error) => err);

  if (ctx instanceof Error) {
    return {
      ok: false,
      status: 401,
      reason: `JWT verification failed: ${ctx.message.slice(0, 160)}`,
    };
  }

  const sc = ctx as {
    checkLocalScope?: (scope: string) => boolean;
    getLogonName?: () => string;
    getEmail?: () => string;
  };
  if (typeof sc.checkLocalScope !== "function") {
    return {
      ok: false,
      status: 500,
      reason: "Unexpected SecurityContext shape from @sap/xssec.",
    };
  }
  if (!sc.checkLocalScope("Admin")) {
    return {
      ok: false,
      status: 403,
      reason:
        "Insufficient scope. The 'Admin' role-template (Hyperspace Studio Admin " +
        "role collection) is required to mutate runtime config.",
    };
  }
  return {
    ok: true,
    subject:
      sc.getLogonName?.() ?? sc.getEmail?.() ?? "xsuaa-admin",
  };
}

interface VcapXsuaaCreds {
  clientid: string;
  clientsecret: string;
  url: string;
  xsappname: string;
  identityzone?: string;
  uaadomain?: string;
  verificationkey?: string;
}

function readXsuaaCredentialsFromVcap(): VcapXsuaaCreds | null {
  const vcap = process.env.VCAP_SERVICES;
  if (!vcap) return null;
  try {
    const parsed = JSON.parse(vcap) as Record<
      string,
      Array<{ credentials?: VcapXsuaaCreds }>
    >;
    return parsed.xsuaa?.[0]?.credentials ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the connecting peer's IP from the actual TCP socket, falling back to
 * Next.js's `request.ip` (which the runtime adapter populates from the
 * socket on Node-server deployments). We deliberately do NOT consult
 * X-Forwarded-For or X-Real-IP — both are user-supplied and spoofable.
 *
 * Returns null if no socket info is available; callers should refuse admin
 * access in that case rather than guessing.
 */
function trustedPeerIp(req: NextRequest): string | null {
  // Next.js >= 13 on Node runtime exposes `request.ip` populated from the
  // underlying socket. It's typed as `string | undefined` and is `undefined`
  // on the edge runtime (where this code doesn't run anyway — `runtime: nodejs`).
  const r = req as NextRequest & {
    ip?: string;
    socket?: { remoteAddress?: string };
  };
  if (typeof r.ip === "string" && r.ip.length > 0) return r.ip;
  if (r.socket?.remoteAddress) return r.socket.remoteAddress;
  return null;
}

function isLoopback(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.")
  );
}
