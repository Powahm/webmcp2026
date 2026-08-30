import { create } from "zustand";
import type { NodeKind } from "./palette";

/**
 * Entity glyphs.
 *
 * Colour alone is a poor primary cue on a link chart. It fails for the ~8% of
 * men with a colour vision deficiency, it does not survive greyscale or a
 * compressed video, and with four types it makes the legend a decoder ring the
 * reader has to hold in their head. A glyph says what a node *is* at a glance,
 * and the legend drops back to being a reminder.
 *
 * They are editable because the right symbol is a judgement call, and an
 * analyst's habits are not ours to overrule. The choice lives in localStorage,
 * per browser: it is a display preference, not investigation state. Nothing the
 * agent can read or write touches it, and it never reaches the decision log.
 */

export const NODE_KINDS: NodeKind[] = ["company", "person", "address", "document"];

export const DEFAULT_GLYPHS: Record<NodeKind, string> = {
  company: "\u{1F3E2}",
  person: "\u{1F464}",
  address: "\u{1F4CD}",
  document: "\u{1F4C4}",
};

/** Offered in the settings picker. Any character works — these are the ones
 *  that stay legible at 14px on a dark disc. */
export const GLYPH_CHOICES: Record<NodeKind, string[]> = {
  company: ["\u{1F3E2}", "\u{1F3DB}", "▣", "◼", "C"],
  person: ["\u{1F464}", "\u{1F9D1}", "●", "◆", "P"],
  address: ["\u{1F4CD}", "\u{1F3E0}", "▲", "⌂", "A"],
  document: ["\u{1F4C4}", "\u{1F5CE}", "▤", "§", "D"],
};

const STORAGE_KEY = "threadweaver.glyphs.v1";

/** At most two code points: one symbol, or a symbol plus a variation selector.
 *  Anything longer stops being a glyph and starts being a label. */
const clamp = (raw: string, fallback: string): string => {
  const trimmed = [...raw.trim()].slice(0, 2).join("");
  return trimmed || fallback;
};

function load(): Record<NodeKind, string> {
  const out = { ...DEFAULT_GLYPHS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<Record<NodeKind, string>>;
    for (const kind of NODE_KINDS) {
      const value = parsed[kind];
      if (typeof value === "string") out[kind] = clamp(value, DEFAULT_GLYPHS[kind]);
    }
  } catch {
    // Private window, blocked site data, or a corrupt value. Defaults are fine;
    // a display preference is never worth failing a boot over.
  }
  return out;
}

function save(glyphs: Record<NodeKind, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(glyphs));
  } catch {
    // Not being able to remember a preference is not an error worth surfacing.
  }
}

interface GlyphState {
  glyphs: Record<NodeKind, string>;
  setGlyph: (type: NodeKind, glyph: string) => void;
  reset: () => void;
}

export const useGlyphStore = create<GlyphState>((set) => ({
  glyphs: load(),
  setGlyph: (type, glyph) =>
    set((state) => {
      const next = { ...state.glyphs, [type]: clamp(glyph, DEFAULT_GLYPHS[type]) };
      save(next);
      return { glyphs: next };
    }),
  reset: () => {
    save(DEFAULT_GLYPHS);
    set({ glyphs: { ...DEFAULT_GLYPHS } });
  },
}));

/**
 * Read outside React. The canvas draws on animation frames rather than on
 * renders, so it cannot use the hook — and the rAF loop is already running, so
 * a change here appears on the very next frame with no invalidation needed.
 */
export const glyphFor = (type: NodeKind): string =>
  useGlyphStore.getState().glyphs[type];
