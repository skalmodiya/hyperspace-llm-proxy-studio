"use client";

import { CopyButton } from "./copy-button";
import { cn } from "@/lib/utils";

export function JsonViewer({
  data,
  className,
  label = "Raw JSON",
  collapsible = false,
}: {
  data: unknown;
  className?: string;
  label?: string;
  collapsible?: boolean;
}) {
  const text = JSON.stringify(data, null, 2);
  return (
    <details
      className={cn(
        "rounded-md border bg-card text-card-foreground",
        className
      )}
      open={!collapsible}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground flex items-center justify-between">
        <span>{label}</span>
        <CopyButton text={text} className="h-6" />
      </summary>
      <pre className="max-h-[480px] overflow-auto px-3 pb-3 text-[11px] leading-relaxed font-mono">
        {text}
      </pre>
    </details>
  );
}
