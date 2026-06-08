"use client";

/**
 * Browser → Next.js API client. Never reaches the proxy directly.
 */
import { useQuery } from "@tanstack/react-query";
import type { Model } from "@/lib/providers/types";

export interface HealthResponse {
  proxy: { url: string; reachable: boolean; status: number | null };
  providers: Array<{
    provider: string;
    ok: boolean;
    modelCount?: number;
    latencyMs?: number;
    error?: string;
  }>;
  checkedAt: string;
  durationMs: number;
}

export interface ModelsResponse {
  models: Model[];
  byProvider: Array<{
    provider: string;
    models: Model[];
    error: string | null;
  }>;
  fetchedAt: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // For state-changing methods we need to attach the Approuter's CSRF token.
  // On non-BTP runs (no Approuter) the /csrf-token endpoint returns 404 and
  // we silently proceed — the Next.js handlers don't enforce CSRF themselves
  // (the Approuter is the layer that does that on BTP).
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutating = method !== "GET" && method !== "HEAD";
  const extraHeaders: Record<string, string> = {};
  if (isMutating) {
    const token = await getCsrfToken();
    if (token) extraHeaders["x-csrf-token"] = token;
    // Non-BTP admin path: the user pastes STUDIO_ADMIN_TOKEN once in
    // localStorage; we attach it to admin requests automatically. On BTP
    // this is unused — the Approuter forwards a JWT that Next.js verifies.
    const adminToken =
      typeof window !== "undefined"
        ? window.localStorage.getItem("studio:admin-token")
        : null;
    if (adminToken) extraHeaders["x-studio-admin-token"] = adminToken;
  }

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (json as { error?: { message?: string } })?.error?.message ??
      `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json as T;
}

let csrfTokenCache: string | null = null;
async function getCsrfToken(): Promise<string | null> {
  if (csrfTokenCache) return csrfTokenCache;
  try {
    const res = await fetch("/csrf-token", {
      method: "GET",
      headers: { "x-csrf-token": "fetch" }, // Approuter convention
    });
    // Approuter returns the token in the response header on a successful GET.
    const t = res.headers.get("x-csrf-token");
    if (t && t !== "required") {
      csrfTokenCache = t;
      return t;
    }
  } catch {
    /* no Approuter — local dev path */
  }
  return null;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/api/health"),
    refetchInterval: 30_000,
  });
}

export function useModels(provider?: string) {
  return useQuery({
    queryKey: ["models", provider ?? "all"],
    queryFn: () =>
      fetchJson<ModelsResponse>(
        provider ? `/api/models?provider=${provider}` : "/api/models"
      ),
    staleTime: 60_000,
  });
}

export interface SettingsResponse {
  proxyUrl: string;
  apiKeySet: boolean;
  requestTimeoutMs: number;
  retryCount: number;
  debug: boolean;
  flags: {
    hyperspaceEnabled: boolean;
    sapAiCoreEnabled: boolean;
    btpTrimMode: boolean;
  };
  sapAiCore: {
    configured: boolean;
    source: "vcap-services" | "file" | "env-json" | "settings-ui" | "none";
    apiBase: string | null;
    resourceGroup: string;
    clientIdPreview: string | null;
    tokenCached: boolean;
    tokenExpiresInMs: number | null;
  };
  /** Indicates whether the GET response was returned in admin (full) form
   *  or non-admin (masked) form. Useful for the UI to show "paste your
   *  admin token to see config" rather than blank fields. */
  authz: { isAdmin: boolean };
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchJson<SettingsResponse>("/api/settings"),
  });
}

export async function patchSettings(
  body: Partial<{
    proxyUrl: string;
    apiKey: string;
    requestTimeoutMs: number;
    retryCount: number;
    aiCoreResourceGroup: string;
    aiCoreServiceKeyJson: string;
    aiCoreClearOverride: true;
  }>
): Promise<SettingsResponse> {
  return fetchJson<SettingsResponse>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export interface ResourceGroupsResponse {
  configured: boolean;
  groups: Array<{ id: string; status: string }>;
  error: string | null;
}

export function useResourceGroups(enabled = true) {
  return useQuery({
    queryKey: ["sap-ai-core", "resource-groups"],
    queryFn: () =>
      fetchJson<ResourceGroupsResponse>("/api/sap-ai-core/resource-groups"),
    enabled,
    staleTime: 60_000,
  });
}

export { fetchJson };
