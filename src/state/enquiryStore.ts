import { create } from "zustand";
import type { Enquiry } from "../types";

/**
 * Lines of enquiry — MIRSAP's Actions.
 *
 * The analyst raises them, in their own words. The agent can list them and
 * result them. **Only the analyst files one**, and there is no tool that does:
 * closing a question is a judgement about sufficiency, which is the Reader's
 * job and not the Indexer's. See docs/METHOD.md.
 */

interface EnquiryState {
  enquiries: Map<string, Enquiry>;
  _setEnquiries: (e: Map<string, Enquiry>) => void;
}

export const useEnquiryStore = create<EnquiryState>((set) => ({
  enquiries: new Map(),
  _setEnquiries: (enquiries) => set({ enquiries }),
}));

export const enquiries = () => useEnquiryStore.getState();

/** Newest first — the analyst's most recent question is the one they mean. */
export const enquiryList = (m: Map<string, Enquiry>): Enquiry[] =>
  [...m.values()].sort((a, b) => b.created_at - a.created_at);

export const openEnquiries = (m: Map<string, Enquiry>): Enquiry[] =>
  enquiryList(m).filter((e) => e.status === "open" || e.status === "claimed");
