import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers-client";
import { Sidebar } from "@/components/app/sidebar";
import { TopBar } from "@/components/app/topbar";

export const metadata: Metadata = {
  title: "Hyperspace LLM Proxy Studio",
  description:
    "Modern interface for the Hyperspace LLM Proxy — chat, embeddings, models, health.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <TopBar />
              <main className="flex-1 px-4 py-6 md:px-8 md:py-8 overflow-x-hidden">
                {children}
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
