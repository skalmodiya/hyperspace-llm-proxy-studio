/**
 * GET /api/models — aggregate models across all providers.
 * Optional ?provider=anthropic to scope to one.
 */
import { NextRequest } from "next/server";
import { getProvider, listProviderIds } from "@/lib/providers";
import { ProviderIdSchema } from "@/lib/schemas";
import { jsonOk, fromUnknown } from "@/lib/http";
import type { Model } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const filter = url.searchParams.get("provider");

    const ids = filter
      ? [ProviderIdSchema.parse(filter)]
      : listProviderIds();

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const models = await getProvider(id).listModels();
          return { provider: id, models, error: null };
        } catch (err) {
          return {
            provider: id,
            models: [] as Model[],
            error: err instanceof Error ? err.message : "unknown",
          };
        }
      })
    );

    const flat: Model[] = results.flatMap((r) => r.models);
    return jsonOk({
      models: flat,
      byProvider: results,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return fromUnknown(err);
  }
}
