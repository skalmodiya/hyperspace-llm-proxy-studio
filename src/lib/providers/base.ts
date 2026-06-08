/**
 * Base provider — shared HTTP fetcher + retry/timeout handling.
 * All proxy traffic flows through this file.
 */
import { getEffectiveEnv } from "@/lib/env";
import { ProviderError, type ProviderId } from "./types";

interface FetchOptions {
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Override timeout (ms). */
  timeoutMs?: number;
}

export abstract class BaseProvider {
  abstract readonly id: ProviderId;
  /** Path prefix on the proxy, e.g. "/anthropic/v1". */
  protected abstract readonly basePath: string;

  protected get env() {
    return getEffectiveEnv();
  }

  protected url(path: string): string {
    const base = this.env.HYPERSPACE_PROXY_URL.replace(/\/$/, "");
    const prefix = this.basePath.startsWith("/")
      ? this.basePath
      : `/${this.basePath}`;
    const tail = path.startsWith("/") ? path : `/${path}`;
    return `${base}${prefix}${tail}`;
  }

  protected buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extra,
    };
    if (this.env.HYPERSPACE_API_KEY) {
      headers["Authorization"] = `Bearer ${this.env.HYPERSPACE_API_KEY}`;
    }
    return headers;
  }

  protected async request<T = unknown>(opts: FetchOptions): Promise<T> {
    const url = this.url(opts.path);
    const timeoutMs = opts.timeoutMs ?? this.env.HYPERSPACE_REQUEST_TIMEOUT_MS;
    const retries = this.env.HYPERSPACE_RETRY_COUNT;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const signal = opts.signal
        ? mergeSignals(opts.signal, controller.signal)
        : controller.signal;

      try {
        const res = await fetch(url, {
          method: opts.method ?? "POST",
          headers: this.buildHeaders(opts.headers),
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text();
          let upstream: unknown = text;
          try {
            upstream = JSON.parse(text);
          } catch {
            /* keep text */
          }
          // Retry on 5xx + 429 only.
          if ((res.status >= 500 || res.status === 429) && attempt < retries) {
            await sleep(backoffMs(attempt));
            lastError = new ProviderError(
              this.id,
              res.status,
              `Upstream ${res.status}`,
              upstream
            );
            continue;
          }
          throw new ProviderError(
            this.id,
            res.status,
            `Upstream ${res.status}: ${typeof upstream === "object" ? JSON.stringify(upstream).slice(0, 200) : String(upstream).slice(0, 200)}`,
            upstream
          );
        }

        // Successful path — caller may want streaming or JSON.
        return (await res.json()) as T;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        if (
          attempt < retries &&
          (err instanceof TypeError || // network error
            (err instanceof DOMException && err.name === "AbortError" && !opts.signal?.aborted))
        ) {
          await sleep(backoffMs(attempt));
          continue;
        }
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(
          this.id,
          0,
          err instanceof Error ? err.message : "Unknown error"
        );
      }
    }
    throw lastError ?? new ProviderError(this.id, 0, "Request failed");
  }

  /** Stream raw Response for SSE/chunked transfer; caller parses the body. */
  protected async streamRequest(opts: FetchOptions): Promise<Response> {
    const url = this.url(opts.path);
    const timeoutMs = opts.timeoutMs ?? this.env.HYPERSPACE_REQUEST_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = opts.signal
      ? mergeSignals(opts.signal, controller.signal)
      : controller.signal;

    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers: this.buildHeaders({
        ...opts.headers,
        Accept: "text/event-stream",
      }),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal,
    });
    // The timer keeps running for the lifetime of the stream;
    // the fetch's own signal will abort if it fires.
    void timer;

    if (!res.ok) {
      const text = await res.text();
      throw new ProviderError(this.id, res.status, `Stream upstream ${res.status}`, text);
    }
    if (!res.body) {
      throw new ProviderError(this.id, 0, "Empty stream body");
    }
    return res;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  // 250, 500, 1000 …
  return Math.min(4000, 250 * 2 ** attempt);
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([a, b]);
  }
  const ctl = new AbortController();
  const onAbort = (s: AbortSignal) => () => ctl.abort(s.reason);
  a.addEventListener("abort", onAbort(a));
  b.addEventListener("abort", onAbort(b));
  if (a.aborted) ctl.abort(a.reason);
  if (b.aborted) ctl.abort(b.reason);
  return ctl.signal;
}

/** Generic SSE line parser — yields {event, data} objects. */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>
): AsyncIterable<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      yield parseChunk(chunk);
    }
  }
  if (buffer.trim()) yield parseChunk(buffer);
}

function parseChunk(chunk: string): { event?: string; data: string } {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  return { event, data: dataLines.join("\n") };
}
