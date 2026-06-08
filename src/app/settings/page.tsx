"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { patchSettings, useModels, useResourceGroups, useSettings } from "@/lib/api";
import { usePreferences } from "@/lib/store";
import { PROVIDER_LABELS } from "@/lib/providers/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Select, Switch } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Save, KeyRound } from "lucide-react";
import type { Model, ProviderId } from "@/lib/providers/types";

export default function SettingsPage() {
  const settings = useSettings();
  const prefs = usePreferences();
  const qc = useQueryClient();
  const models = useModels();

  const allModels: Model[] = models.data?.models ?? [];

  // Chat models for the *currently selected* default provider, sorted by name.
  // The embedding list is cross-provider because users routinely pair an
  // OpenAI chat model with a Gemini embedding model.
  const chatModelsForProvider = React.useMemo(
    () =>
      allModels
        .filter(
          (m) => m.provider === prefs.defaultProvider && m.type !== "embedding"
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allModels, prefs.defaultProvider]
  );

  // Auto-correct a stale defaultChatModel when:
  //   (a) the persisted id belongs to a *different* provider (user switched
  //       Default Provider — keeping the old id and labeling it "(unavailable)"
  //       is misleading); or
  //   (b) the persisted id no longer appears in the live model list for the
  //       SAME provider AND the live list is non-empty (the model was retired).
  // We do NOT touch defaultChatModel when the live list is empty/loading —
  // that would clobber the saved value during a transient outage.
  React.useEffect(() => {
    if (chatModelsForProvider.length === 0) return; // models still loading
    if (!allModels.length) return;
    const current = prefs.defaultChatModel;
    const matchInProvider = chatModelsForProvider.some(
      (m) => m.id === current
    );
    if (matchInProvider) return; // already valid; nothing to do

    const matchAnyProvider = allModels.find((m) => m.id === current);
    const fromDifferentProvider =
      matchAnyProvider !== undefined &&
      matchAnyProvider.provider !== prefs.defaultProvider;

    if (fromDifferentProvider || matchAnyProvider === undefined) {
      // Replace with the first model of the chosen provider — silent in case
      // (a), surfaced as "(unavailable)" only when the live list is empty
      // (handled by the dropdown's existing rendering).
      prefs.setChatModel(chatModelsForProvider[0].id);
    }
    // We deliberately depend only on the provider id and the resolved list —
    // not on `prefs.defaultChatModel` — to avoid loops when prefs.setChatModel
    // is called from inside this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.defaultProvider, chatModelsForProvider, allModels.length]);

  const embeddingModels = React.useMemo(
    () =>
      allModels
        .filter(
          (m) => m.type === "embedding" || m.id.toLowerCase().includes("embed")
        )
        .sort(
          (a, b) =>
            a.provider.localeCompare(b.provider) ||
            a.name.localeCompare(b.name)
        ),
    [allModels]
  );

  const [proxyUrl, setProxyUrl] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [timeoutMs, setTimeoutMs] = React.useState<number>(60_000);
  const [retryCount, setRetryCount] = React.useState<number>(2);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Hydrate the form from server settings the first time they arrive.
  React.useEffect(() => {
    if (!settings.data) return;
    setProxyUrl((cur) => cur || settings.data!.proxyUrl);
    setTimeoutMs((cur) => cur || settings.data!.requestTimeoutMs);
    setRetryCount((cur) => cur ?? settings.data!.retryCount);
  }, [settings.data]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await patchSettings({
        proxyUrl: proxyUrl || undefined,
        // Only send API key if user typed something — empty means "leave alone".
        ...(apiKey ? { apiKey } : {}),
        requestTimeoutMs: timeoutMs,
        retryCount,
      });
      setSavedAt(Date.now());
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onClearKey = async () => {
    setSaving(true);
    try {
      await patchSettings({ apiKey: "" });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  };

  // --- SAP AI Core --------------------------------------------------------

  const [aicoreRG, setAicoreRG] = React.useState("");
  const [aicoreJson, setAicoreJson] = React.useState("");
  const [aicoreSaving, setAicoreSaving] = React.useState(false);
  const [aicoreError, setAicoreError] = React.useState<string | null>(null);
  const [aicoreSavedAt, setAicoreSavedAt] = React.useState<number | null>(null);
  // Live resource group list — only fetched when AI Core is configured.
  const aicoreConfigured = settings.data?.sapAiCore.configured ?? false;
  const resourceGroupsQ = useResourceGroups(aicoreConfigured);

  React.useEffect(() => {
    if (!settings.data) return;
    setAicoreRG((cur) => cur || settings.data!.sapAiCore.resourceGroup);
  }, [settings.data]);

  const onSaveAiCore = async () => {
    setAicoreSaving(true);
    setAicoreError(null);
    try {
      await patchSettings({
        ...(aicoreRG ? { aiCoreResourceGroup: aicoreRG } : {}),
        ...(aicoreJson ? { aiCoreServiceKeyJson: aicoreJson } : {}),
      });
      setAicoreSavedAt(Date.now());
      setAicoreJson(""); // clear the textarea after a successful paste
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    } catch (e) {
      setAicoreError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setAicoreSaving(false);
    }
  };

  const onClearAiCoreOverride = async () => {
    setAicoreSaving(true);
    try {
      await patchSettings({ aiCoreClearOverride: true });
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      setAicoreError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setAicoreSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how the studio connects to the Hyperspace Proxy. Server-side
          values (proxy URL, API key) are runtime overrides — restart the
          server to revert to <code className="font-mono">.env</code> defaults.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Proxy connection</CardTitle>
          <CardDescription>
            All upstream calls flow from the server to{" "}
            <code className="font-mono">{settings.data?.proxyUrl ?? "—"}</code>.
            The browser never sees this URL or the API key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Proxy URL</Label>
            <Input
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://localhost:6655"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center justify-between">
              <span>
                API key (Bearer)
                {settings.data?.apiKeySet && (
                  <Badge variant="success" className="ml-2">
                    configured
                  </Badge>
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowKey((v) => !v)}
                disabled={!apiKey}
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            </Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings.data?.apiKeySet
                    ? "•••••• (rotation: type new key to overwrite)"
                    : "sk-…"
                }
              />
              {settings.data?.apiKeySet && (
                <Button
                  variant="outline"
                  onClick={onClearKey}
                  disabled={saving}
                  title="Clear API key"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Request timeout (ms)</Label>
              <Input
                type="number"
                value={timeoutMs}
                onChange={(e) => setTimeoutMs(Number(e.target.value) || 0)}
                min={1000}
                step={1000}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Retry count</Label>
              <Input
                type="number"
                value={retryCount}
                onChange={(e) => setRetryCount(Number(e.target.value) || 0)}
                min={0}
                max={10}
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-500">⚠ {error}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={onSave} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </Button>
            {savedAt && (
              <span className="text-[11px] text-muted-foreground">
                Saved at {new Date(savedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            SAP AI Core
            {settings.data?.sapAiCore.configured ? (
              <Badge variant="success">configured</Badge>
            ) : (
              <Badge variant="outline">not configured</Badge>
            )}
            {settings.data?.sapAiCore.source &&
              settings.data.sapAiCore.source !== "none" && (
                <Badge variant="secondary">
                  source: {settings.data.sapAiCore.source}
                </Badge>
              )}
          </CardTitle>
          <CardDescription>
            Credentials are discovered server-side in this order:{" "}
            <code className="font-mono text-[11px]">VCAP_SERVICES</code>{" "}
            (Cloud Foundry binding) →{" "}
            <code className="font-mono text-[11px]">AICORE_SERVICE_KEY_PATH</code>{" "}
            (file mount) →{" "}
            <code className="font-mono text-[11px]">AICORE_SERVICE_KEY_JSON</code>{" "}
            (env) → Settings UI paste below. The browser never sees the
            client secret.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settings.data?.sapAiCore.configured && (
            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
              <div>
                <span className="text-muted-foreground">API base:</span>{" "}
                <code className="font-mono">
                  {settings.data.sapAiCore.apiBase}
                </code>
              </div>
              <div>
                <span className="text-muted-foreground">Client ID:</span>{" "}
                <code className="font-mono">
                  {settings.data.sapAiCore.clientIdPreview}
                </code>
              </div>
              <div>
                <span className="text-muted-foreground">Token cache:</span>{" "}
                {settings.data.sapAiCore.tokenCached
                  ? `valid for ${Math.round(
                      (settings.data.sapAiCore.tokenExpiresInMs ?? 0) / 1000
                    )}s`
                  : "empty (will fetch on next call)"}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Resource Group</Label>
            {(() => {
              const groups = resourceGroupsQ.data?.groups ?? [];
              const adminError = resourceGroupsQ.data?.error ?? null;
              const loading = resourceGroupsQ.isLoading;
              // Three states:
              //   - loading                 → disabled select with one option
              //   - admin call failed (403) → fall back to free-text Input
              //   - groups list returned    → real dropdown, with stale-handling
              if (!aicoreConfigured) {
                return (
                  <Input
                    value={aicoreRG}
                    onChange={(e) => setAicoreRG(e.target.value)}
                    placeholder="default"
                  />
                );
              }
              if (loading) {
                return (
                  <Select value={aicoreRG} disabled>
                    <option value={aicoreRG}>{aicoreRG || "Loading…"}</option>
                  </Select>
                );
              }
              if (adminError && groups.length === 0) {
                // Admin endpoint denied or unreachable — keep free text so the
                // user can still set the value manually (it's a header, the
                // call site doesn't need admin scope).
                return (
                  <>
                    <Input
                      value={aicoreRG}
                      onChange={(e) => setAicoreRG(e.target.value)}
                      placeholder="default"
                    />
                    <p className="text-[10px] text-amber-500">
                      Could not list resource groups (likely missing admin
                      scope on the bound AI Core service key). You can still
                      type the name manually.
                    </p>
                  </>
                );
              }
              const inList = groups.some((g) => g.id === aicoreRG);
              return (
                <Select
                  value={aicoreRG}
                  onChange={(e) => setAicoreRG(e.target.value)}
                >
                  {/* Stale value preserved if it's no longer in the list. */}
                  {aicoreRG && !inList && (
                    <option value={aicoreRG}>
                      {aicoreRG} (unavailable)
                    </option>
                  )}
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.id}
                      {g.status && g.status !== "PROVISIONED"
                        ? ` · ${g.status}`
                        : ""}
                    </option>
                  ))}
                </Select>
              );
            })()}
            <p className="text-[10px] text-muted-foreground">
              Sent as <code className="font-mono">AI-Resource-Group</code> on
              every AI Core call. AI Core admins create resource groups to
              isolate model deployments per environment.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Paste service key JSON (overrides any other source)</Label>
            <textarea
              value={aicoreJson}
              onChange={(e) => setAicoreJson(e.target.value)}
              rows={6}
              spellCheck={false}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px] resize-y"
              placeholder='{ "serviceurls": { "AI_API_URL": "..." }, "clientid": "...", "clientsecret": "...", "url": "..." }'
            />
            <p className="text-[10px] text-muted-foreground">
              Stored in server memory only — resets on cold start. Prefer the
              CF binding (production) or file mount (Kyma) over this.
            </p>
          </div>

          {aicoreError && <p className="text-xs text-red-500">⚠ {aicoreError}</p>}

          <div className="flex items-center gap-3">
            <Button onClick={onSaveAiCore} disabled={aicoreSaving}>
              <Save className="h-4 w-4" />
              {aicoreSaving ? "Saving…" : "Save"}
            </Button>
            {settings.data?.sapAiCore.source === "settings-ui" && (
              <Button
                variant="outline"
                onClick={onClearAiCoreOverride}
                disabled={aicoreSaving}
              >
                <KeyRound className="h-3.5 w-3.5" />
                Clear pasted key
              </Button>
            )}
            {aicoreSavedAt && (
              <span className="text-[11px] text-muted-foreground">
                Saved at {new Date(aicoreSavedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Defaults (browser-local)</CardTitle>
          <CardDescription>
            Stored in <code className="font-mono">localStorage</code>. Used to
            seed the playgrounds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Default provider</Label>
              <Select
                value={prefs.defaultProvider}
                onChange={(e) => prefs.setProvider(e.target.value as ProviderId)}
              >
                {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_LABELS[id]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Default chat model</Label>
              <Select
                value={prefs.defaultChatModel}
                onChange={(e) => prefs.setChatModel(e.target.value)}
                disabled={chatModelsForProvider.length === 0 && !models.isLoading}
              >
                {models.isLoading ? (
                  <option value="">Loading models…</option>
                ) : chatModelsForProvider.length === 0 ? (
                  <option value="">
                    No chat models for {PROVIDER_LABELS[prefs.defaultProvider]}
                  </option>
                ) : (
                  <>
                    {/*
                     * Keep the previously-saved value visible only when it
                     * belongs to the SAME provider but has been retired (or
                     * the live list is incomplete). For cross-provider
                     * mismatches, the auto-correct effect above replaces the
                     * id before this point — so we'd never render
                     * "gpt-4o-mini (unavailable)" under Anthropic.
                     */}
                    {prefs.defaultChatModel &&
                      !chatModelsForProvider.some(
                        (m) => m.id === prefs.defaultChatModel
                      ) &&
                      // Only render the stale entry if the saved id resolves
                      // to the SAME provider in the full model list (or is
                      // entirely unknown). This prevents a no-longer-relevant
                      // id from another provider from leaking through.
                      (allModels.find(
                        (m) => m.id === prefs.defaultChatModel
                      )?.provider ?? prefs.defaultProvider) ===
                        prefs.defaultProvider && (
                        <option value={prefs.defaultChatModel}>
                          {prefs.defaultChatModel} (unavailable)
                        </option>
                      )}
                    {chatModelsForProvider.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </>
                )}
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Scoped to {PROVIDER_LABELS[prefs.defaultProvider]}. Change the
                provider above to see its models.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Default embedding model</Label>
              <Select
                value={prefs.defaultEmbeddingModel}
                onChange={(e) => prefs.setEmbeddingModel(e.target.value)}
                disabled={embeddingModels.length === 0 && !models.isLoading}
              >
                {models.isLoading ? (
                  <option value="">Loading models…</option>
                ) : embeddingModels.length === 0 ? (
                  <option value="">No embedding models discovered</option>
                ) : (
                  <>
                    {prefs.defaultEmbeddingModel &&
                      !embeddingModels.some(
                        (m) => m.id === prefs.defaultEmbeddingModel
                      ) && (
                        <option value={prefs.defaultEmbeddingModel}>
                          {prefs.defaultEmbeddingModel} (unavailable)
                        </option>
                      )}
                    {embeddingModels.map((m) => (
                      <option key={`${m.provider}:${m.id}`} value={m.id}>
                        [{PROVIDER_LABELS[m.provider]}] {m.name}
                      </option>
                    ))}
                  </>
                )}
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Cross-provider list — only embedding-capable models.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Default temperature ({prefs.defaultTemperature.toFixed(2)})</Label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={prefs.defaultTemperature}
                onChange={(e) => prefs.setTemperature(Number(e.target.value))}
                className="w-full accent-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Default max tokens</Label>
              <Input
                type="number"
                value={prefs.defaultMaxTokens}
                onChange={(e) =>
                  prefs.setMaxTokens(Number(e.target.value) || 1024)
                }
                min={1}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>Streaming on by default</Label>
              <Switch
                checked={prefs.defaultStreaming}
                onChange={(e) => prefs.setStreaming(e.target.checked)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Default system prompt</Label>
            <textarea
              value={prefs.systemPrompt}
              onChange={(e) => prefs.setSystemPrompt(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
