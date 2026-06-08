"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Sparkles,
  Boxes,
  Settings as SettingsIcon,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/api";

const FULL_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, trim: true },
  { href: "/chat", label: "Chat Playground", icon: MessageSquare, trim: false },
  { href: "/embeddings", label: "Embeddings", icon: Sparkles, trim: true },
  { href: "/models", label: "Model Explorer", icon: Boxes, trim: true },
  { href: "/health", label: "Proxy Health", icon: Activity, trim: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon, trim: false },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const { data: settings } = useSettings();
  const trim = settings?.flags.btpTrimMode ?? false;

  // BTP_TRIM_MODE keeps only items with trim=false (Chat + Settings).
  const items = FULL_NAV.filter((n) => !trim || !n.trim);

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-card">
      <div className="px-5 py-4 border-b">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-indigo-500 to-fuchsia-500" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Hyperspace</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {trim ? "BTP Studio" : "LLM Proxy Studio"}
            </span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 p-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t text-[10px] text-muted-foreground">
        v0.1 · Next.js 16 · React 19
      </div>
    </aside>
  );
}
