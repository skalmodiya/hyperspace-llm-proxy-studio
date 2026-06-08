import "@testing-library/jest-dom/vitest";

// Polyfill Web APIs that may not exist in jsdom but are used by Next.js code.
if (typeof globalThis.AbortSignal !== "undefined" &&
    typeof (AbortSignal as unknown as { any?: unknown }).any === "undefined") {
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    value: (signals: AbortSignal[]) => {
      const ctl = new AbortController();
      for (const s of signals) {
        if (s.aborted) ctl.abort(s.reason);
        else s.addEventListener("abort", () => ctl.abort(s.reason));
      }
      return ctl.signal;
    },
  });
}
