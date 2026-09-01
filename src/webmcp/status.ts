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
  /**
   * Registered with the browser — but nothing has called a tool yet.
   *
   * This is a distinct state on purpose, and it is the one that misled us.
   * Chrome with chrome://flags/#enable-webmcp-testing exposes
   * navigator.modelContext to every page whether or not an agent is attached,
   * so registration succeeds in an ordinary tab with nobody on the other end.
   * "Live" was true of the tools and false of the situation. The badge now says
   * what it actually knows: the tools are registered, and no agent has used one.
   */
  | { kind: "registered"; where: string; count: number }
  /** No host on the page. The ordinary-browser case. */
  | { kind: "absent" }
  /** We are in an iframe, where tools are never discovered however well they
   *  are registered. Worth calling out separately: it looks identical to
   *  "absent" from the outside and has a completely different fix. */
  | { kind: "framed" };

interface StatusStore {
  status: WebMcpState;
  /**
   * Calls that have started and not yet returned.
   *
   * The page cannot know that a model is thinking — there is no such signal in
   * WebMCP, and claiming one would be theatre. What it does know is that the
   * agent is *in the middle of a call it made*, which is the honest version of
   * the same reassurance, and it is enough to stop the interface looking dead.
   */
  inFlight: number;
  /** Total calls this session. First one flips "registered" to "connected". */
  callCount: number;
  _setStatus: (s: WebMcpState) => void;
  _callStarted: () => void;
  _callEnded: () => void;
}

export const useWebMcpStatus = create<StatusStore>((set) => ({
  status: { kind: "detecting" },
  inFlight: 0,
  callCount: 0,
  _setStatus: (status) => set({ status }),
  _callStarted: () => set((s) => ({ inFlight: s.inFlight + 1, callCount: s.callCount + 1 })),
  _callEnded: () => set((s) => ({ inFlight: Math.max(0, s.inFlight - 1) })),
}));

/** Something on the other end has actually used a tool. */
export const agentHasCalled = (): boolean => useWebMcpStatus.getState().callCount > 0;

/** Set from register.ts, which runs outside React. */
export const setWebMcpStatus = (status: WebMcpState): void =>
  useWebMcpStatus.getState()._setStatus(status);

/** Called from instrument.ts around every tool invocation. */
export const callStarted = (): void => useWebMcpStatus.getState()._callStarted();
export const callEnded = (): void => useWebMcpStatus.getState()._callEnded();
