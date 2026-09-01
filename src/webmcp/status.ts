import { create } from "zustand";

/**
 * Whether a WebMCP host is actually listening.
 *
 * The top bar used to claim "19 WebMCP tools" unconditionally, which is a lie
 * in an ordinary browser: the tools are defined, but nothing has discovered
 * them and no agent can call one. Registration already knows the answer — it
 * feature-detects the host and bails out in three distinguishable ways — so it
 * publishes the result here and the badge reports it honestly.
 *
 * "Off" is not an error state. Threadweaver is a complete tool without an
 * agent; the badge says the agent half is unavailable, not that anything is
 * broken.
 */
export type WebMcpState =
  | { kind: "detecting" }
  /** Registered. `where` is the location we found — the spec's
   *  document.modelContext, or Chrome's older navigator.modelContext. */
  | { kind: "active"; where: string; count: number }
  /** No host on the page. The ordinary-browser case. */
  | { kind: "absent" }
  /** We are in an iframe, where tools are never discovered however well they
   *  are registered. Worth calling out separately: it looks identical to
   *  "absent" from the outside and has a completely different fix. */
  | { kind: "framed" };

interface StatusStore {
  status: WebMcpState;
  _setStatus: (s: WebMcpState) => void;
}

export const useWebMcpStatus = create<StatusStore>((set) => ({
  status: { kind: "detecting" },
  _setStatus: (status) => set({ status }),
}));

/** Set from register.ts, which runs outside React. */
export const setWebMcpStatus = (status: WebMcpState): void =>
  useWebMcpStatus.getState()._setStatus(status);
