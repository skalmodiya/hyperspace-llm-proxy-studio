"use client";

import { useHealth, useModels } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS } from "@/lib/providers/types";
import { RefreshCcw, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const health = useHealth();
  const models = useModels();

  const totalModels = models.data?.models.length ?? 0;
  const okProviders =
    health.data?.providers.filter((p) => p.ok).length ?? 0;
  const totalProviders = health.data?.providers.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Overview of the Hyperspace LLM Proxy and its providers.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            health.refetch();
            models.refetch();
          }}
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Proxy"
          value={
            health.isLoading
              ? "…"
              : health.data?.proxy.reachable
                ? "Reachable"
                : "Unreachable"
          }
          subtitle={health.data?.proxy.url}
          tone={health.data?.proxy.reachable ? "good" : "bad"}
        />
        <StatCard
          title="Providers"
          value={
            health.isLoading ? "…" : `${okProviders} / ${totalProviders}`
          }
          subtitle="Online via the proxy"
          tone={
            okProviders === totalProviders && totalProviders > 0
              ? "good"
              : okProviders === 0
                ? "bad"
                : "warn"
          }
        />
        <StatCard
          title="Models"
          value={models.isLoading ? "…" : String(totalModels)}
          subtitle="Discovered across providers"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider connectivity</CardTitle>
            <CardDescription>
              Each provider is probed via its `/models` endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {health.data?.providers.map((p) => (
              <div
                key={p.provider}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-2">
                  {p.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className="text-sm font-medium">
                    {PROVIDER_LABELS[
                      p.provider as keyof typeof PROVIDER_LABELS
                    ] ?? p.provider}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {p.ok ? (
                    <>
                      <span>{p.modelCount} models</span>
                      <Badge variant="secondary">{p.latencyMs} ms</Badge>
                    </>
                  ) : (
                    <span className="truncate max-w-[16rem]">
                      {p.error ?? "Unreachable"}
                    </span>
                  )}
                </div>
              </div>
            )) ?? (
              <p className="text-sm text-muted-foreground">
                Loading providers…
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>
              Jump into the most common workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <Link href="/chat">
              <Button variant="outline" className="w-full justify-start">
                Chat Playground
              </Button>
            </Link>
            <Link href="/embeddings">
              <Button variant="outline" className="w-full justify-start">
                Embeddings
              </Button>
            </Link>
            <Link href="/models">
              <Button variant="outline" className="w-full justify-start">
                Model Explorer
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="outline" className="w-full justify-start">
                Configure proxy
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Last refresh:{" "}
        {health.data
          ? new Date(health.data.checkedAt).toLocaleString()
          : "—"}
      </p>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  tone = "default",
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : tone === "bad"
          ? "text-red-500"
          : "";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">
          {title}
        </CardDescription>
        <CardTitle className={`text-2xl ${toneClass}`}>{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground truncate">
          {subtitle ?? ""}
        </p>
      </CardContent>
    </Card>
  );
}
