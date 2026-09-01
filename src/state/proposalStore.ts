import { create } from "zustand";
import type { Proposal } from "../types";

/**
 * Staged, unconfirmed claims. Write tools reach only this store, and only
 * through actions.ts. Nothing here is part of the graph until a human accepts
 * it, see the note at the bottom of docs/TOOLS.md on why there is no commit
 * tool.
 */

interface ProposalState {
  proposals: Map<string, Proposal>;
  _setProposals: (p: Map<string, Proposal>) => void;
}

export const useProposalStore = create<ProposalState>((set) => ({
  proposals: new Map(),
  _setProposals: (proposals) => set({ proposals }),
}));

export const proposals = () => useProposalStore.getState();

export const pendingProposals = (p: Map<string, Proposal>): Proposal[] =>
  [...p.values()].filter((x) => x.status === "pending").sort((a, b) => a.created_at - b.created_at);
