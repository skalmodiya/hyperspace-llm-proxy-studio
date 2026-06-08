/**
 * Route Handler helpers — JSON responses, error envelopes.
 */
import { ProviderError } from "./providers/types";

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export function jsonError(
  message: string,
  status = 400,
  extra?: Record<string, unknown>
): Response {
  return new Response(
    JSON.stringify({ error: { message, ...(extra ?? {}) } }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export function fromUnknown(err: unknown): Response {
  if (err instanceof ProviderError) {
    return jsonError(err.message, err.status || 502, {
      provider: err.provider,
      upstream: err.upstream,
    });
  }
  if (err instanceof Error) {
    return jsonError(err.message, 500);
  }
  return jsonError("Unknown error", 500);
}
