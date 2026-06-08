"use client";

import * as React from "react";
import { useModels } from "@/lib/api";
import { usePreferences } from "@/lib/store";
import { PROVIDER_LABELS } from "@/lib/providers/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/ui/json-viewer";
import { CopyButton } from "@/components/ui/copy-button";
import { Sparkles, Plus, X } from "lucide-react";
import type {
  EmbeddingResponse,
  ProviderId,
} from "@/lib/providers/types";

const TASK_TYPES = [
  "RETRIEVAL_QUERY",
  "RETRIEVAL_DOCUMENT",
  "SEMANTIC_SIMILARITY",
  "CLASSIFICATION",
  "CLUSTERING",
] as const;

export default function EmbeddingsPage() {
  const prefs = usePreferences();
  const { data: modelsData } = useModels();
  const allModels = modelsData?.models ?? [];

  const embeddingProviders: ProviderId[] = ["openai", "gemini", "litellm"];
  const [provider, setProvider] = React.useState<ProviderId>("openai");
  const embedModels = allModels.filter(
    (m) => m.provider === provider && (m.type === "embedding" || m.id.includes("embed"))
  );

  const [model, setModel] = React.useState<string>(prefs.defaultEmbeddingModel);

  React.useEffect(() => {
    if (embedModels.length === 0) return;
    if (!embedModels.some((m) => m.id === model)) {
      setModel(embedModels[0].id);
    }
  }, [embedModels, model]);

  const [singleText, setSingleText] = React.useState(
    "The quick brown fox jumps over the lazy dog."
  );
  const [batchTexts, setBatchTexts] = React.useState<string[]>([
    "The quick brown fox jumps over the lazy dog.",
    "Embeddings encode meaning into vectors.",
  ]);
  const [taskType, setTaskType] =
    React.useState<(typeof TASK_TYPES)[number]>("RETRIEVAL_DOCUMENT");
  const [title, setTitle] = React.useState("");

  const [response, setResponse] = React.useState<EmbeddingResponse | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"single" | "batch">("single");

  const onRun = async () => {
    setError(null);
    setBusy(true);
    setResponse(null);
    try {
      const body = {
        provider,
        model,
        input: activeTab === "single" ? singleText : batchTexts,
        ...(provider === "gemini"
          ? { taskType, ...(title.trim() ? { title: title.trim() } : {}) }
          : {}),
      };
      const res = await fetch("/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error?.message ?? `Failed (${res.status})`
        );
      }
      setResponse(json);
      prefs.setEmbeddingModel(model);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle>Embeddings Playground</CardTitle>
          <CardDescription>
            Generate vector embeddings for one or more inputs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "single" | "batch")}
          >
            <TabsList>
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="batch">Batch</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="space-y-2">
              <Label>Input text</Label>
              <Textarea
                value={singleText}
                onChange={(e) => setSingleText(e.target.value)}
                className="min-h-[140px]"
              />
            </TabsContent>

            <TabsContent value="batch" className="space-y-2">
              <Label>Inputs ({batchTexts.length})</Label>
              <div className="space-y-2">
                {batchTexts.map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Textarea
                      value={t}
                      onChange={(e) =>
                        setBatchTexts((xs) =>
                          xs.map((x, j) => (j === i ? e.target.value : x))
                        )
                      }
                      className="min-h-[60px]"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setBatchTexts((xs) =>
                          xs.length > 1 ? xs.filter((_, j) => j !== i) : xs
                        )
                      }
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBatchTexts((xs) => [...xs, ""])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add input
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between gap-2">
            <Button onClick={onRun} disabled={busy || !model}>
              <Sparkles className="h-4 w-4" />
              {busy ? "Generating…" : "Generate embeddings"}
            </Button>
            {response && (
              <Badge variant="secondary">
                {response.vectors.length} vector
                {response.vectors.length === 1 ? "" : "s"} ·{" "}
                {response.dimensions} dims
              </Badge>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-500">⚠ {error}</p>
          )}

          {response && (
            <div className="space-y-3">
              {response.vectors.map((v) => (
                <Card key={v.index} className="bg-muted/30">
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">
                        #{v.index} · {v.values.length} dims
                      </CardTitle>
                      <CopyButton text={JSON.stringify(v.values)} label="Copy" />
                    </div>
                    {v.inputPreview && (
                      <CardDescription className="text-[11px] truncate">
                        {v.inputPreview}
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="pt-0">
                    <pre className="text-[10px] font-mono leading-tight max-h-32 overflow-auto">
                      [
                      {v.values.slice(0, 16).map((n) => n.toFixed(6)).join(", ")}
                      {v.values.length > 16 ? `, … (${v.values.length - 16} more)` : ""}
                      ]
                    </pre>
                  </CardContent>
                </Card>
              ))}
              <JsonViewer data={response.raw ?? response} collapsible />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle className="text-sm">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderId)}
            >
              {embeddingProviders.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {embedModels.length === 0 ? (
                <option value="">No embedding models</option>
              ) : (
                embedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              )}
            </Select>
          </div>

          {provider === "gemini" && (
            <>
              <div className="space-y-1.5">
                <Label>Task type</Label>
                <Select
                  value={taskType}
                  onChange={(e) =>
                    setTaskType(e.target.value as (typeof TASK_TYPES)[number])
                  }
                >
                  {TASK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Title (optional)</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="For RETRIEVAL_DOCUMENT only"
                />
              </div>
            </>
          )}

          <div className="rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground leading-relaxed">
            OpenAI / LiteLLM use <code className="font-mono">{`{model, input}`}</code>.
            Gemini uses an <code className="font-mono">instances[]</code> array
            with <code>task_type</code>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
