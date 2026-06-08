/**
 * POST /api/chat — non-streaming + streaming.
 * Streaming is signalled by `stream: true` in the JSON body; the response is
 * SSE-encoded JSON chunks of {delta?, finishReason?, usage?, citations?}.
 */
import { NextRequest } from "next/server";
import { getProvider } from "@/lib/providers";
import { ChatRequestSchema } from "@/lib/schemas";
import { fromUnknown, jsonOk } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = ChatRequestSchema.parse(json);
    const provider = getProvider(parsed.provider);

    if (parsed.stream && provider.chatStream) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = (obj: unknown) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
            );
          try {
            for await (const chunk of provider.chatStream!(
              { ...parsed, provider: parsed.provider, messages: parsed.messages },
              req.signal
            )) {
              send(chunk);
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (err) {
            send({
              error: err instanceof Error ? err.message : "Stream failed",
            });
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const res = await provider.chat({
      ...parsed,
      provider: parsed.provider,
      messages: parsed.messages,
    });
    return jsonOk(res);
  } catch (err) {
    return fromUnknown(err);
  }
}
