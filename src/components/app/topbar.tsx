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
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/api";

const FULL_NAV = [
  { href: "/", icon: LayoutDashboard, label: "Home", trim: true },
  { href: "/chat", icon: MessageSquare, label: "Chat", trim: false },
  { href: "/embeddings", icon: Sparkles, label: "Embed", trim: true },
  { href: "/models", icon: Boxes, label: "Models", trim: true },
  { href: "/health", icon: Activity, label: "Health", trim: true },
  { href: "/settings", icon: SettingsIcon, label: "Settings", trim: false },
] as const;

export function TopBar() {
  const pathname = usePathname();
  const { data: settings } = useSettings();
  const trim = settings?.flags.btpTrimMode ?? false;
  const items = FULL_NAV.filter((n) => !trim || !n.trim);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="md:hidden flex items-center gap-1 overflow-x-auto">
        {items.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </div>
      <div className="hidden md:block text-sm text-muted-foreground">
        {pageTitle(pathname)}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  );
}

function pageTitle(pathname: string | null) {
  if (!pathname) return "";
  if (pathname === "/") return "Dashboard";
  if (pathname.startsWith("/chat")) return "Chat Playground";
  if (pathname.startsWith("/embeddings")) return "Embeddings Playground";
  if (pathname.startsWith("/models")) return "Model Explorer";
  if (pathname.startsWith("/health")) return "Proxy Health";
  if (pathname.startsWith("/settings")) return "Settings";
  return "";
}
