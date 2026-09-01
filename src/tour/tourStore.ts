import { create } from "zustand";

/**
 * The first-run introduction, and the ? button that replays it.
 *
 * `localStorage`, not the `sessionStorage` the markings use: "the first time
 * you ever opened this" is a different question from "the first time in this
 * tab", and the tour answers the first one. A returning analyst should not be
 * met by a walkthrough they already sat through, and the ? button means nobody
 * is ever locked out of seeing it again.
 */

const KEY = "threadweaver:intro-seen:v1";

export function introSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    // Storage disabled. Treat as seen rather than showing the tour on every
    // load forever, an unskippable-feeling tour is worse than no tour.
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* nothing to do; the tour simply may run again next time */
  }
}

interface TourState {
  open: boolean;
  /** Index into TOUR_STEPS. */
  step: number;
  start: () => void;
  next: () => void;
  back: () => void;
  goTo: (i: number) => void;
  close: () => void;
}

export const useTourStore = create<TourState>((set) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  next: () => set((s) => ({ step: s.step + 1 })),
  back: () => set((s) => ({ step: Math.max(0, s.step - 1) })),
  goTo: (step) => set({ step }),
  close: () => {
    markSeen();
    set({ open: false, step: 0 });
  },
}));
