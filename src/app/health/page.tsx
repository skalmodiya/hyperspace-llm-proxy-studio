"use client";

import { useHealth } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/ui/json-viewer";
import { CheckCircle2, XCircle, RefreshCcw } from "lucide-react";

export default function HealthPage() {
  const { data, refetch, isFetching, dataUpdatedAt } = useHealth();

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Proxy Health</h1>
          <p className="text-sm text-muted-foreground">
            Live diagnostic of the Hyperspace Proxy and each provider it fronts.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Probe now
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Proxy</CardTitle>
          <CardDescription>{data?.proxy.url ?? "—"}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          {data?.proxy.reachable ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <span className="text-sm">
            {data?.proxy.reachable ? "Reachable" : "Unreachable"}
          </span>
          {data?.proxy.status !== null && data?.proxy.status !== undefined && (
            <Badge variant="secondary">HTTP {data.proxy.status}</Badge>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            Total probe: {data?.durationMs ?? "—"} ms
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {data?.providers.map((p) => (
          <Card key={p.provider}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {PROVIDER_LABELS[
                    p.provider as keyof typeof PROVIDER_LABELS
                  ] ?? p.provider}
                </CardTitle>
                {p.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>
            </CardHeader>
            <CardContent className="text-xs space-y-1 text-muted-foreground">
              {p.ok ? (
                <>
                  <p>Models discovered: {p.modelCount}</p>
                  <p>Probe latency: {p.latencyMs} ms</p>
                </>
              ) : (
                <p className="text-red-500">{p.error ?? "Unreachable"}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Last refresh: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleString() : "—"}
      </p>

      {data && <JsonViewer data={data} collapsible />}
    </div>
  );
}
