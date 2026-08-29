import { create } from "zustand";
import type { ToolCallLogEntry } from "../types";

/**
 * Every WebMCP call, with its arguments and how long it took.
 *
 * This is not a debug panel. It is the visible proof that the standard is doing
 * the work rather than a chatbot narrating over a screenshot, and it is the
 * cheapest thing in the project that raises the WebMCP Leverage score.
 */

const MAX_ENTRIES = 200;

interface ToolLogState {
  entries: ToolCallLogEntry[];
  _push: (e: ToolCallLogEntry) => void;
  clear: () => void;
}

export const useToolLogStore = create<ToolLogState>((set) => ({
  entries: [],
  _push: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, MAX_ENTRIES) })),
  clear: () => set({ entries: [] }),
}));

export const toolLog = () => useToolLogStore.getState();
