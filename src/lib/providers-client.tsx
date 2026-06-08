"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  return (
    // next-themes injects a small <script> child to set the theme class on
    // <html> before React hydrates. Without disableTransitionOnChange this is
    // fine but the script triggers React 19's "script tag inside component"
    // warning. We render with suppressHydrationWarning on <html> (set in
    // layout.tsx) so the brief light→dark swap on first paint doesn't whine.
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
