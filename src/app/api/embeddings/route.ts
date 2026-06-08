/**
 * POST /api/embeddings — single or batch embeddings.
 */
import { NextRequest } from "next/server";
import { getProvider } from "@/lib/providers";
import { EmbeddingRequestSchema } from "@/lib/schemas";
import { fromUnknown, jsonOk } from "@/lib/http";
import { ProviderError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = EmbeddingRequestSchema.parse(json);
    const provider = getProvider(parsed.provider);
    if (!provider.embeddings) {
      throw new ProviderError(
        parsed.provider,
        400,
        `Provider ${parsed.provider} does not support embeddings`
      );
    }
    const res = await provider.embeddings({
      ...parsed,
      provider: parsed.provider,
    });
    return jsonOk(res);
  } catch (err) {
    return fromUnknown(err);
  }
}
