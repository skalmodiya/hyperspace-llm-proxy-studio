"use client";

import * as React from "react";
import { useModels } from "@/lib/api";
import { PROVIDER_LABELS } from "@/lib/providers/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { JsonViewer } from "@/components/ui/json-viewer";
import { RefreshCcw } from "lucide-react";
import type { Model, ProviderId } from "@/lib/providers/types";

export default function ModelsPage() {
  const { data, isLoading, refetch, isFetching } = useModels();
  const [search, setSearch] = React.useState("");
  const [providerFilter, setProviderFilter] = React.useState<"all" | ProviderId>("all");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "chat" | "embedding">("all");

  const filtered: Model[] = React.useMemo(() => {
    const all = data?.models ?? [];
    return all.filter((m) => {
      if (providerFilter !== "all" && m.provider !== providerFilter) return false;
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !m.id.toLowerCase().includes(s) &&
          !m.name.toLowerCase().includes(s)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data, search, providerFilter, typeFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Model Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Models discovered dynamically from each provider&apos;s
            <code className="mx-1 font-mono">/models</code> endpoint.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label>Search</Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="model id or name"
            />
          </div>
          <div className="space-y-1">
            <Label>Provider</Label>
            <Select
              value={providerFilter}
              onChange={(e) =>
                setProviderFilter(e.target.value as typeof providerFilter)
              }
            >
              <option value="all">All providers</option>
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as typeof typeFilter)
              }
            >
              <option value="all">All types</option>
              <option value="chat">Chat</option>
              <option value="embedding">Embedding</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {isLoading
          ? "Loading models…"
          : `${filtered.length} of ${data?.models.length ?? 0} models`}
      </p>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((m) => (
          <Card key={`${m.provider}:${m.id}`}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm break-all">{m.name}</CardTitle>
                <CopyButton text={m.id} className="h-6" />
              </div>
              <CardDescription className="text-[11px] flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline">{PROVIDER_LABELS[m.provider]}</Badge>
                <Badge
                  variant={m.type === "embedding" ? "secondary" : "default"}
                >
                  {m.type}
                </Badge>
                {m.contextWindow && (
                  <Badge variant="outline">
                    {m.contextWindow.toLocaleString()} ctx
                  </Badge>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-[10px] font-mono text-muted-foreground break-all">
                {m.id}
              </p>
              {m.capabilities && m.capabilities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {m.capabilities.slice(0, 4).map((c) => (
                    <Badge key={c} variant="outline" className="text-[10px]">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {data?.byProvider.some((p) => p.error) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-red-500">
              {data.byProvider
                .filter((p) => p.error)
                .map((p) => (
                  <li key={p.provider}>
                    <strong>{p.provider}:</strong> {p.error}
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {data && (
        <JsonViewer
          data={data.byProvider}
          label="Raw response (per-provider)"
          collapsible
        />
      )}
    </div>
  );
}
