"use client";

/**
 * Zustand store — client-side preferences (default model, last used provider, etc.).
 * Persisted to localStorage so a refresh keeps the user's place.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProviderId } from "@/lib/providers/types";

export interface PreferencesState {
  defaultProvider: ProviderId;
  defaultChatModel: string;
  defaultEmbeddingModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  defaultStreaming: boolean;
  systemPrompt: string;
  setProvider: (id: ProviderId) => void;
  setChatModel: (m: string) => void;
  setEmbeddingModel: (m: string) => void;
  setTemperature: (t: number) => void;
  setMaxTokens: (n: number) => void;
  setStreaming: (b: boolean) => void;
  setSystemPrompt: (s: string) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      defaultProvider: "anthropic",
      defaultChatModel: "anthropic--claude-4.6-sonnet",
      defaultEmbeddingModel: "text-embedding-3-small",
      defaultTemperature: 0.7,
      defaultMaxTokens: 1024,
      defaultStreaming: true,
      systemPrompt: "",
      setProvider: (id) => set({ defaultProvider: id }),
      setChatModel: (m) => set({ defaultChatModel: m }),
      setEmbeddingModel: (m) => set({ defaultEmbeddingModel: m }),
      setTemperature: (t) => set({ defaultTemperature: t }),
      setMaxTokens: (n) => set({ defaultMaxTokens: n }),
      setStreaming: (b) => set({ defaultStreaming: b }),
      setSystemPrompt: (s) => set({ systemPrompt: s }),
    }),
    { name: "hyperspace-prefs" }
  )
);
