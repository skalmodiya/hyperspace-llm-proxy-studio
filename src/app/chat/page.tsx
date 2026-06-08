"use client";

import * as React from "react";
import { useModels } from "@/lib/api";
import { usePreferences } from "@/lib/store";
import { PROVIDER_LABELS } from "@/lib/providers/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Switch, Textarea } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { CopyButton } from "@/components/ui/copy-button";
import { JsonViewer } from "@/components/ui/json-viewer";
import { Send, Square, Trash2, Download, ExternalLink } from "lucide-react";
import type {
  ChatMessage,
  ChatResponse,
  ProviderId,
} from "@/lib/providers/types";

interface DisplayMessage extends ChatMessage {
  /** Local UI id. */
  uid: string;
  citations?: string[];
  raw?: unknown;
  pending?: boolean;
}

export default function ChatPage() {
  const prefs = usePreferences();
  const { data: modelsData } = useModels();
  const allModels = modelsData?.models ?? [];

  const chatModels = allModels.filter(
    (m) => m.provider === prefs.defaultProvider && m.type !== "embedding"
  );

  const [model, setModel] = React.useState<string>(prefs.defaultChatModel);
  const [temperature, setTemperature] = React.useState(prefs.defaultTemperature);
  const [maxTokens, setMaxTokens] = React.useState(prefs.defaultMaxTokens);
  const [streaming, setStreaming] = React.useState(prefs.defaultStreaming);
  const [systemPrompt, setSystemPrompt] = React.useState(prefs.systemPrompt);
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<DisplayMessage[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-pick a model if current one is unavailable.
  React.useEffect(() => {
    if (chatModels.length === 0) return;
    if (!chatModels.some((m) => m.id === model)) {
      setModel(chatModels[0].id);
    }
  }, [chatModels, model]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const onProviderChange = (id: ProviderId) => {
    prefs.setProvider(id);
  };

  const onSend = async () => {
    if (!input.trim() || busy) return;
    setError(null);

    const userMsg: DisplayMessage = {
      uid: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };
    const assistantMsg: DisplayMessage = {
      uid: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
    };
    const next = [...messages, userMsg, assistantMsg];
    setMessages(next);
    setInput("");

    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);

    const body = {
      provider: prefs.defaultProvider,
      model,
      temperature,
      maxTokens,
      stream: streaming,
      systemPrompt: systemPrompt.trim() || undefined,
      messages: [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    try {
      if (streaming) {
        await streamChat(body, ctl.signal, (delta, meta) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.uid === assistantMsg.uid
                ? {
                    ...m,
                    content: m.content + (delta ?? ""),
                    citations: meta?.citations ?? m.citations,
                    raw: meta?.raw ?? m.raw,
                    pending: !meta?.done,
                  }
                : m
            )
          );
        });
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error?.message ?? `Failed (${res.status})`);
        }
        const data = json as ChatResponse;
        setMessages((prev) =>
          prev.map((m) =>
            m.uid === assistantMsg.uid
              ? {
                  ...m,
                  content: data.content,
                  citations: data.citations,
                  raw: data.raw,
                  pending: false,
                }
              : m
          )
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setError(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.uid === assistantMsg.uid
            ? { ...m, content: m.content || `_Error: ${msg}_`, pending: false }
            : m
        )
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onStop = () => {
    abortRef.current?.abort();
  };

  const onClear = () => {
    setMessages([]);
    setError(null);
  };

  const onExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      provider: prefs.defaultProvider,
      model,
      temperature,
      maxTokens,
      systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hyperspace-chat-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="flex flex-col h-[calc(100vh-8rem)]">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Chat Playground</CardTitle>
              <CardDescription>
                {PROVIDER_LABELS[prefs.defaultProvider]} · {model || "no model"}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onExport}
                disabled={messages.length === 0}
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClear}
                disabled={messages.length === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            messages.map((m) => <Bubble key={m.uid} msg={m} />)
          )}
        </div>

        <div className="border-t p-3 space-y-2">
          {error && (
            <p className="text-xs text-red-500 px-1">⚠ {error}</p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder="Ask anything…  (Ctrl/Cmd+Enter to send)"
              className="min-h-[60px] resize-none"
            />
            {busy ? (
              <Button onClick={onStop} variant="destructive">
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button onClick={onSend} disabled={!input.trim() || !model}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Sidebar: model + parameters */}
      <Card className="h-fit lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
        <CardHeader>
          <CardTitle className="text-sm">Configuration</CardTitle>
          <CardDescription>Sent on every request.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select
              value={prefs.defaultProvider}
              onChange={(e) => onProviderChange(e.target.value as ProviderId)}
            >
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Model</Label>
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {chatModels.length === 0 ? (
                <option value="">No models loaded</option>
              ) : (
                chatModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))
              )}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Temperature ({temperature.toFixed(2)})</Label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full accent-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Max tokens</Label>
            <Input
              type="number"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value) || 1024)}
              min={1}
              max={32000}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>Streaming</Label>
            <Switch
              checked={streaming}
              onChange={(e) => setStreaming(e.target.checked)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>System prompt</Label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant."
              className="min-h-[100px]"
            />
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground leading-relaxed">
            All requests go server-side via{" "}
            <code className="font-mono">/api/chat</code>. The proxy URL and API
            key are never exposed to the browser.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center space-y-2 p-8">
      <div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 opacity-80" />
      <h3 className="text-base font-medium">Start a conversation</h3>
      <p className="text-xs text-muted-foreground max-w-md">
        Pick a provider and model on the right, then send a message. Streaming
        responses, code highlighting, citations, and raw JSON inspection are all
        supported.
      </p>
    </div>
  );
}

function Bubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg border ${
          isUser ? "bg-primary text-primary-foreground" : "bg-card"
        } px-4 py-3 space-y-2`}
      >
        <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider opacity-70">
          <span>{msg.role}</span>
          {!isUser && msg.content && (
            <CopyButton text={msg.content} className="h-5 px-1" />
          )}
        </div>
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
        ) : (
          <Markdown content={msg.content || (msg.pending ? "▌" : "")} />
        )}
        {msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-col gap-1 pt-1 border-t border-white/10">
            <span className="text-[10px] uppercase tracking-wider opacity-70">
              Citations
            </span>
            {msg.citations.map((c, i) => (
              <a
                key={i}
                href={c}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] inline-flex items-center gap-1 hover:underline truncate"
              >
                <ExternalLink className="h-3 w-3" />
                {c}
              </a>
            ))}
          </div>
        )}
        {!isUser && Boolean(msg.raw) && (
          <JsonViewer
            data={msg.raw}
            label="Raw response"
            collapsible
            className="mt-2 bg-background/50"
          />
        )}
        {msg.pending && (
          <Badge variant="secondary" className="text-[10px]">
            streaming…
          </Badge>
        )}
      </div>
    </div>
  );
}

interface ChatRequestBody {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
}

async function streamChat(
  body: ChatRequestBody,
  signal: AbortSignal,
  onDelta: (
    delta: string,
    meta?: {
      done?: boolean;
      citations?: string[];
      raw?: unknown;
    }
  ) => void
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error?.message ?? `Stream failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let collectedRaw: unknown = null;
  let collectedCitations: string[] | undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.citations) collectedCitations = parsed.citations;
          if (parsed.delta) {
            onDelta(parsed.delta, {
              citations: collectedCitations,
            });
          }
          if (parsed.finishReason) {
            collectedRaw = parsed;
          }
        } catch (e) {
          if (e instanceof Error) throw e;
        }
      }
    }
  }

  onDelta("", { done: true, citations: collectedCitations, raw: collectedRaw });
}
