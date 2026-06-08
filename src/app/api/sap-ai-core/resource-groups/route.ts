/**
 * GET /api/sap-ai-core/resource-groups
 *
 * Lists the resource groups the bound AI Core service can see. Used by the
 * Settings page to render the RG field as a dropdown.
 */
import { NextRequest } from "next/server";
import { fromUnknown, jsonOk } from "@/lib/http";
import { tryGetCredentials } from "@/lib/providers/sap-ai-core/credentials";
import { getAccessToken } from "@/lib/providers/sap-ai-core/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const creds = tryGetCredentials();
    if (!creds) {
      return jsonOk({
        configured: false,
        groups: [],
        error: "AI Core credentials not configured",
      });
    }
    const token = await getAccessToken(creds);
    const res = await fetch(`${creds.apiBase}/v2/admin/resourceGroups`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return jsonOk({
        configured: true,
        groups: [],
        // 403 here means the bound service key doesn't have admin scope —
        // fine, just show "default" + the free-text fallback in the UI.
        error: `AI Core /v2/admin/resourceGroups ${res.status}: ${text.slice(0, 160)}`,
      });
    }
    const data = (await res.json()) as {
      resources?: Array<{
        resourceGroupId?: string;
        status?: string;
        zoneId?: string;
        createdAt?: string;
      }>;
    };
    const groups = (data.resources ?? [])
      .map((r) => ({
        id: r.resourceGroupId ?? "",
        status: r.status ?? "UNKNOWN",
      }))
      .filter((g) => g.id);
    return jsonOk({ configured: true, groups, error: null });
  } catch (err) {
    return fromUnknown(err);
  }
}
