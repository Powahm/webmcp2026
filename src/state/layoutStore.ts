import { create } from "zustand";

/**
 * How wide the rails are, and how tall the tool log is.
 *
 * Null until the analyst drags something. That matters: App.css sets
 * --rail-left and --rail-right inside width media queries, and an inline style
 * would beat them at every viewport. Staying null keeps the responsive defaults
 * in charge until someone expresses a preference, and only then overrides.
 *
 * Persisted per tab, like the markings, so a refresh keeps the layout you set
 * and a new session starts from the defaults.
 */

const KEY = "threadweaver:layout:v1";

export interface Bounds {
  min: number;
  max: number;
}

/** Wide enough to read a filing title, narrow enough to leave the stage room. */
export const RAIL_LEFT: Bounds = { min: 150, max: 520 };
export const RAIL_RIGHT: Bounds = { min: 240, max: 640 };
/** The floor is one row plus the header, so the panel can never be dragged shut
 *  by accident and leave no way to get it back. */
export const TOOL_LOG: Bounds = { min: 74, max: 560 };

export const clamp = (v: number, b: Bounds): number => Math.min(b.max, Math.max(b.min, Math.round(v)));

export interface LayoutSizes {
  railLeft: number | null;
  railRight: number | null;
  toolLog: number | null;
}

interface LayoutState extends LayoutSizes {
  set: (key: keyof LayoutSizes, value: number) => void;
  reset: () => void;
}

function restore(): LayoutSizes {
  const empty: LayoutSizes = { railLeft: null, railRight: null, toolLog: null };
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw) as Partial<LayoutSizes>;
    const num = (x: unknown, b: Bounds) => (typeof x === "number" && Number.isFinite(x) ? clamp(x, b) : null);
    return {
      railLeft: num(v.railLeft, RAIL_LEFT),
      railRight: num(v.railRight, RAIL_RIGHT),
      toolLog: num(v.toolLog, TOOL_LOG),
    };
  } catch {
    return empty;
  }
}

function save(s: LayoutSizes): void {
  try {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ railLeft: s.railLeft, railRight: s.railRight, toolLog: s.toolLog })
    );
  } catch {
    /* storage disabled; the layout simply does not survive a reload */
  }
}

const BOUNDS: Record<keyof LayoutSizes, Bounds> = {
  railLeft: RAIL_LEFT,
  railRight: RAIL_RIGHT,
  toolLog: TOOL_LOG,
};

export const useLayoutStore = create<LayoutState>((set, get) => ({
  ...restore(),
  set: (key, value) => {
    set({ [key]: clamp(value, BOUNDS[key]) } as Pick<LayoutState, keyof LayoutSizes>);
    const { railLeft, railRight, toolLog } = get();
    save({ railLeft, railRight, toolLog });
  },
  reset: () => {
    set({ railLeft: null, railRight: null, toolLog: null });
    save({ railLeft: null, railRight: null, toolLog: null });
  },
}));
