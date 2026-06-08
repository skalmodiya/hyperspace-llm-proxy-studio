import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCredentials,
  setRuntimeOverride,
  clearRuntimeOverride,
  _resetCredentialsCache,
} from "../credentials";
import { clearTokenCache, getAccessToken } from "../token";

const SAMPLE_KEY = {
  // Real SAP-shaped hosts so the allowlist in src/lib/security.ts accepts
  // them (matches the shape of a real service key, just with test values).
  serviceurls: { AI_API_URL: "https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com" },
  appname: "test-app",
  clientid: "sb-test-clientid",
  clientsecret: "test-clientsecret",
  identityzone: "test-tenant",
  url: "https://test-tenant.authentication.us10.hana.ondemand.com",
  "credential-type": "binding-secret",
  "token-type": ["xsuaa"],
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.VCAP_SERVICES;
  delete process.env.AICORE_SERVICE_KEY_PATH;
  delete process.env.AICORE_SERVICE_KEY_JSON;
  _resetCredentialsCache();
  clearRuntimeOverride();
  clearTokenCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("AI Core credentials", () => {
  it("parses VCAP_SERVICES.aicore[0].credentials", () => {
    process.env.VCAP_SERVICES = JSON.stringify({
      aicore: [{ credentials: SAMPLE_KEY }],
    });
    const c = getCredentials();
    expect(c.source).toBe("vcap-services");
    expect(c.apiBase).toBe("https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com");
    expect(c.clientId).toBe("sb-test-clientid");
    expect(c.tokenUrl).toBe(
      "https://test-tenant.authentication.us10.hana.ondemand.com"
    );
    expect(c.fingerprint).toMatch(/^[0-9a-f]+$/);
  });

  it("parses AICORE_SERVICE_KEY_JSON env var as a fallback", () => {
    process.env.AICORE_SERVICE_KEY_JSON = JSON.stringify(SAMPLE_KEY);
    const c = getCredentials();
    expect(c.source).toBe("env-json");
  });

  it("settings-ui override beats env sources", () => {
    process.env.AICORE_SERVICE_KEY_JSON = JSON.stringify(SAMPLE_KEY);
    setRuntimeOverride(
      JSON.stringify({
        ...SAMPLE_KEY,
        clientid: "sb-OVERRIDE-clientid",
      })
    );
    const c = getCredentials();
    expect(c.source).toBe("settings-ui");
    expect(c.clientId).toBe("sb-OVERRIDE-clientid");
  });

  it("rejects malformed keys with a helpful error", () => {
    expect(() =>
      setRuntimeOverride(JSON.stringify({ clientid: "x" }))
    ).toThrow();
  });

  it("rejects service keys whose API host is outside the SAP allowlist (SSRF guard)", () => {
    const evil = {
      ...SAMPLE_KEY,
      serviceurls: { AI_API_URL: "https://attacker.example.com" },
    };
    expect(() => setRuntimeOverride(JSON.stringify(evil))).toThrow(
      /SAP-controlled host/i
    );
  });

  it("rejects service keys whose token URL is outside the SAP allowlist (SSRF guard)", () => {
    const evil = {
      ...SAMPLE_KEY,
      url: "https://attacker.example.com",
    };
    expect(() => setRuntimeOverride(JSON.stringify(evil))).toThrow(
      /SAP authentication host/i
    );
  });

  it("throws when no source is configured", () => {
    expect(() => getCredentials()).toThrow(/not configured/i);
  });
});

describe("AI Core token cache", () => {
  it("fetches a token, caches it, and reuses it", async () => {
    process.env.AICORE_SERVICE_KEY_JSON = JSON.stringify(SAMPLE_KEY);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "jwt-1",
          expires_in: 3600,
          token_type: "bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t1 = await getAccessToken();
    const t2 = await getAccessToken();
    expect(t1).toBe("jwt-1");
    expect(t2).toBe("jwt-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify URL + Basic auth shape on the call.
    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit | undefined]
    >;
    expect(calls[0][0]).toBe(
      "https://test-tenant.authentication.us10.hana.ondemand.com/oauth/token"
    );
    const headers = calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it("refreshes the token when the cached one is near expiry", async () => {
    process.env.AICORE_SERVICE_KEY_JSON = JSON.stringify(SAMPLE_KEY);
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      // First call: a "stale" token expiring in 30s (< the 60s leeway).
      // Second call: a fresh token.
      const expires = call === 1 ? 30 : 3600;
      return new Response(
        JSON.stringify({
          access_token: `jwt-${call}`,
          expires_in: expires,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const t1 = await getAccessToken();
    const t2 = await getAccessToken(); // should refresh because t1 was within leeway
    expect(t1).toBe("jwt-1");
    expect(t2).toBe("jwt-2");
  });

  it("propagates non-200 token errors", async () => {
    process.env.AICORE_SERVICE_KEY_JSON = JSON.stringify(SAMPLE_KEY);
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 401 })
    ) as unknown as typeof fetch;
    await expect(getAccessToken()).rejects.toThrow(/401/);
  });
});
