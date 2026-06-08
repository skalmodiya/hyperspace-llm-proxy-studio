/**
 * AI Core deployment discovery.
 *
 * Unlike the four other providers, AI Core does NOT expose models by name.
 * You list *deployments* in a Resource Group; each deployment has a configurationName
 * (template), a modelName, and a stable id. Inference URLs are
 * `{apiBase}/v2/inference/deployments/{id}/...`.
 *
 * We resolve a friendly model id ("anthropic--claude-4.6-sonnet") to a
 * deployment id at request time. This keeps our normalized ChatRequest shape
 * unchanged from the other providers.
 */
import type { Model } from "../types";
import { getCredentials } from "./credentials";
import { getAccessToken } from "./token";

interface AiCoreDeploymentEntry {
  id: string;
  configurationName?: string;
  configurationId?: string;
  scenarioId?: string;
  status?: string;
  targetStatus?: string;
  details?: {
    resources?: { backend_details?: { model?: { name?: string; version?: string } } };
    scaling?: { backend_details?: unknown };
  };
  // Some tenants put model metadata on the top level.
  modelName?: string;
  deploymentUrl?: string;
}

interface AiCoreDeploymentList {
  count?: number;
  resources?: AiCoreDeploymentEntry[];
}

export interface ResolvedDeployment {
  id: string;
  modelName: string;
  scenarioId?: string;
  status?: string;
  family: ModelFamily;
  type: "chat" | "embedding";
}

export type ModelFamily =
  | "anthropic"
  | "openai"
  | "embedding"
  | "orchestration"
  | "other";

const cache = new Map<string, { fetchedAt: number; deployments: ResolvedDeployment[] }>();
const TTL_MS = 60_000;

export async function listDeployments(
  resourceGroup: string
): Promise<ResolvedDeployment[]> {
  const cached = cache.get(resourceGroup);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.deployments;

  const creds = getCredentials();
  const token = await getAccessToken(creds);

  // Only list "RUNNING" deployments — others can't serve inference.
  const url = `${creds.apiBase}/v2/lm/deployments?status=RUNNING`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "AI-Resource-Group": resourceGroup,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `AI Core /v2/lm/deployments ${res.status}: ${text.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as AiCoreDeploymentList;
  const resolved = (data.resources ?? [])
    .map(toResolved)
    .filter((d): d is ResolvedDeployment => d !== null);

  cache.set(resourceGroup, { fetchedAt: Date.now(), deployments: resolved });
  return resolved;
}

export function clearDeploymentCache() {
  cache.clear();
}

/** Map a friendly model id (or deployment id directly) to a deployment. */
export async function resolveDeployment(
  modelOrDeploymentId: string,
  resourceGroup: string
): Promise<ResolvedDeployment> {
  const dep = await tryResolveDeployment(modelOrDeploymentId, resourceGroup);
  if (dep) return dep;
  throw new Error(
    `No running AI Core deployment found for "${modelOrDeploymentId}" in resource group "${resourceGroup}"`
  );
}

/** Same as resolveDeployment but returns null instead of throwing. */
export async function tryResolveDeployment(
  modelOrDeploymentId: string,
  resourceGroup: string
): Promise<ResolvedDeployment | null> {
  const list = await listDeployments(resourceGroup);
  const byId = list.find((d) => d.id === modelOrDeploymentId);
  if (byId) return byId;
  const target = modelOrDeploymentId.toLowerCase();
  const byModel = list.find((d) => d.modelName.toLowerCase() === target);
  if (byModel) return byModel;
  const byPartial = list.find((d) => d.modelName.toLowerCase().includes(target));
  if (byPartial) return byPartial;
  return null;
}

/** Convert deployments to our generic Model[] for the Models endpoint + UI.
 *  Orchestration deployments are infrastructure, not user-pickable models —
 *  they don't appear in this list, but findOrchestrationDeployment() still
 *  finds them for routing purposes.
 *
 *  When an orchestration deployment exists in the resource group, we ALSO
 *  enumerate every foundation model the tenant supports and surface them
 *  as selectable models with a "via orchestration" capability marker. The
 *  user picks (say) "anthropic--claude-4.6-sonnet" and the chat code routes
 *  it through the orchestration deployment automatically. */
export async function listAsModels(
  resourceGroup: string
): Promise<Model[]> {
  const list = await listDeployments(resourceGroup);

  // 1. Direct deployments (excluding orchestration wrappers).
  const direct = list
    .filter((d) => d.family !== "orchestration")
    .map<Model>((d) => ({
      id: d.modelName,
      name: `${d.modelName}  ·  ${d.id.slice(0, 8)}`,
      provider: "sap-ai-core",
      type: d.type,
      capabilities: [d.family, d.scenarioId ?? "foundation-models"],
      metadata: { deploymentId: d.id, family: d.family, status: d.status },
    }));

  // 2. Orchestration-routable models, but only if there's a RUNNING
  //    orchestration deployment in this resource group. Otherwise it would
  //    be misleading to surface them — the chat call would fail.
  const hasOrch = list.some((d) => d.family === "orchestration");
  if (!hasOrch) return direct;

  let routable: Model[] = [];
  try {
    routable = await listOrchestrationModels(resourceGroup);
  } catch {
    // Foundation-models scenario probe failed (RBAC, network). Direct
    // deployments still work; just log nothing extra.
    return direct;
  }

  // De-dupe: if a model is BOTH directly deployed AND routable via
  // orchestration (rare, but possible), prefer the direct entry.
  const directIds = new Set(direct.map((m) => m.id));
  const merged = [
    ...direct,
    ...routable.filter((m) => !directIds.has(m.id)),
  ];
  return merged;
}

interface FoundationModelEntry {
  model: string;
  executableId?: string;
  description?: string;
  displayName?: string;
  provider?: string;
  versions?: Array<{
    name?: string;
    isLatest?: boolean;
    deprecated?: boolean;
    contextLength?: number;
    inputTypes?: string[];
    capabilities?: string[];
    streamingSupported?: boolean;
  }>;
  allowedScenarios?: Array<{ executableId?: string; scenarioId?: string }>;
}

interface FoundationModelsResponse {
  count?: number;
  resources?: FoundationModelEntry[];
}

const orchModelsCache = new Map<
  string,
  { fetchedAt: number; models: Model[] }
>();

/**
 * Fetch the catalog of foundation models the tenant exposes, filtered to
 * those allowed under the orchestration scenario, and reshape as Model[].
 */
async function listOrchestrationModels(
  resourceGroup: string
): Promise<Model[]> {
  const cached = orchModelsCache.get(resourceGroup);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.models;

  const creds = getCredentials();
  const token = await getAccessToken(creds);
  const res = await fetch(
    `${creds.apiBase}/v2/lm/scenarios/foundation-models/models`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "AI-Resource-Group": resourceGroup,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI Core foundation-models ${res.status}: ${text.slice(0, 160)}`);
  }
  const data = (await res.json()) as FoundationModelsResponse;

  const models: Model[] = [];
  for (const m of data.resources ?? []) {
    if (!m.model) continue;
    const allowsOrch = (m.allowedScenarios ?? []).some(
      (s) => s.scenarioId === "orchestration"
    );
    if (!allowsOrch) continue;
    const latest =
      m.versions?.find((v) => v.isLatest) ?? m.versions?.[0];
    if (latest?.deprecated) continue;
    const family = classify(m.model);
    if (family === "orchestration") continue; // shouldn't happen; defensive

    const isEmbed =
      family === "embedding" ||
      (latest?.capabilities ?? []).some((c) => c.includes("embedding")) ||
      m.model.toLowerCase().includes("embed");

    models.push({
      id: m.model,
      name: m.displayName ?? m.model,
      provider: "sap-ai-core",
      type: isEmbed ? "embedding" : "chat",
      contextWindow: latest?.contextLength,
      capabilities: [
        "via orchestration",
        family,
        ...(latest?.capabilities ?? []),
      ],
      metadata: {
        family,
        vendor: m.provider,
        executableId: m.executableId,
        streamingSupported: latest?.streamingSupported ?? null,
        viaOrchestration: true,
      },
    });
  }

  // Stable sort by family then name so the dropdown reads sensibly.
  models.sort((a, b) => {
    const fa = (a.capabilities?.[1] ?? "") + a.name;
    const fb = (b.capabilities?.[1] ?? "") + b.name;
    return fa.localeCompare(fb);
  });

  orchModelsCache.set(resourceGroup, { fetchedAt: Date.now(), models });
  return models;
}

export function clearOrchestrationModelsCache() {
  orchModelsCache.clear();
}

function toResolved(entry: AiCoreDeploymentEntry): ResolvedDeployment | null {
  const id = entry.id;
  const modelName =
    entry.modelName ??
    entry.details?.resources?.backend_details?.model?.name ??
    entry.configurationName;
  if (!id || !modelName) return null;
  const family = classify(modelName);
  return {
    id,
    modelName,
    scenarioId: entry.scenarioId,
    status: entry.status,
    family,
    type: family === "embedding" ? "embedding" : "chat",
  };
}

function classify(modelName: string): ModelFamily {
  const m = modelName.toLowerCase();
  if (m.includes("embedding") || m.includes("embed")) return "embedding";
  // "orchestration", "defaultOrchestrationConfig", anything containing
  // "orchestration" — these are dispatch-only deployments, not user-facing
  // models.
  if (m.includes("orchestration")) return "orchestration";
  if (m.includes("claude") || m.includes("anthropic")) return "anthropic";
  if (m.startsWith("gpt") || m.includes("openai") || /^o\d/.test(m)) {
    return "openai";
  }
  return "other";
}

/**
 * Find a "RUNNING" orchestration deployment in the resource group, if any.
 * Returns null if none exists. Used to route Anthropic / non-OpenAI families
 * through SAP's orchestration service instead of attempting direct
 * `/invoke` paths (which the direct Anthropic deployments may not expose).
 */
export async function findOrchestrationDeployment(
  resourceGroup: string
): Promise<ResolvedDeployment | null> {
  const list = await listDeployments(resourceGroup);
  return (
    list.find(
      (d) =>
        d.family === "orchestration" ||
        d.scenarioId === "orchestration" ||
        d.modelName.toLowerCase().includes("orchestration")
    ) ?? null
  );
}
