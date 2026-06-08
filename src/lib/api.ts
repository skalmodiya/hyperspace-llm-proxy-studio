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
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
