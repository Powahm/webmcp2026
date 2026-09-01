import { create } from "zustand";
import type { MarkingType } from "../types";

/**
 * Cursor or highlighter, and which colour the highlighter is loaded with.
 *
 * Two modes rather than one, because the two things an analyst does over a
 * filing want opposite defaults. Reading and quoting wants a selection that
 * stays a selection until you decide what it is; working through a filing
 * marking every address wants the selection to become a mark the moment you
 * let go, without a dialog in the way each time.
 *
 * So: cursor mode asks, highlighter mode acts. The loaded colour is shown on
 * the button, the way a real highlighter shows its own ink.
 */

export type ReaderMode = "cursor" | "highlight";

interface ModeState {
  mode: ReaderMode;
  /** The ink. Also the default the cursor-mode popup pre-selects. */
  colour: MarkingType;
  setMode: (m: ReaderMode) => void;
  /** Picking a colour arms the highlighter: choosing ink means you want to use it. */
  pick: (c: MarkingType) => void;
}

export const useReaderMode = create<ModeState>((set) => ({
  mode: "cursor",
  colour: "person",
  setMode: (mode) => set({ mode }),
  pick: (colour) => set({ colour, mode: "highlight" }),
}));
