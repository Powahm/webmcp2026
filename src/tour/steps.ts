/**
 * The introduction sequence, as data.
 *
 * Targets are `data-tour` attributes rather than CSS classes, so restyling
 * cannot silently break the tour by renaming a class — a tour that points at
 * nothing is worse than no tour, and the failure is invisible until someone
 * runs it.
 *
 * `before` drives the real interface: a step about the Enquiries panel selects
 * that tab first, so the analyst is looking at the genuine panel with genuine
 * content. Nothing here is a screenshot or a mock.
 *
 * Copy discipline: at most two short sentences per card. A tour that has to be
 * read is a tour that gets skipped, and a skipped tour teaches nothing.
 */

export type TourSide = "top" | "bottom" | "left" | "right" | "center";

export interface TourStep {
  /** `data-tour` value to spotlight. Omit for a centred card with no cutout. */
  target?: string;
  title: string;
  body: string;
  side?: TourSide;
  /** Runs before the step is shown, to put the app in the right state. */
  before?: (api: TourApi) => void;
}

export interface TourApi {
  setWorkspace: (w: "read" | "canvas") => void;
  setTab: (t: "details" | "proposals" | "enquiries" | "evidence" | "log") => void;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Threadweaver",
    body:
      "A canvas for investigative work, built on real UK Companies House records. You and an agent build the same graph — you read and decide, it searches and suggests.",
    side: "center",
    before: (a) => {
      a.setWorkspace("read");
      a.setTab("details");
    },
  },
  {
    title: "Two rules, before anything else",
    body:
      "The agent can propose, never commit — only you put something on the canvas. And every claim it makes carries a citation you can open and read.",
    side: "center",
  },
  {
    target: "workspace",
    title: "Two workspaces",
    body:
      "Read is where you work. Canvas is the shared picture. Press W to switch — both stay live, so you never lose your place.",
    side: "bottom",
    before: (a) => a.setWorkspace("read"),
  },
  {
    target: "rail-left",
    title: "The corpus",
    body:
      "1,158 real filings covering 2,717 entities. Your canvas starts with twelve of them — the gap between the two is the investigation.",
    side: "right",
  },
  {
    target: "filing",
    title: "Read the record",
    body:
      "The public filing, verbatim, never summarised. This is what you check the agent's claims against.",
    side: "left",
  },
  {
    target: "markbar",
    title: "Mark what matters",
    body:
      "Select a passage and press 1–6 to type it. A mark is not a highlighter — it is an instruction: the agent reads what you marked and starts there.",
    side: "top",
  },
  {
    target: "rail-tabs",
    title: "Details — what you have selected",
    body:
      "Click a node and it appears here. Select a second and you can draw the connection yourself, with no agent involved.",
    side: "left",
    before: (a) => a.setTab("details"),
  },
  {
    target: "rail-tabs",
    title: "Proposals — suggested, not accepted",
    body:
      "What the agent thinks belongs on the canvas, drawn dashed. Nothing here is real until you accept it, and there is no tool that lets the agent accept its own.",
    side: "left",
    before: (a) => a.setTab("proposals"),
  },
  {
    target: "rail-tabs",
    title: "Enquiries — your questions",
    body:
      "Ask in your own words. The agent takes one, works it, and reports back — including 'found nothing', which is a real result. Only you close an enquiry.",
    side: "left",
    before: (a) => a.setTab("enquiries"),
  },
  {
    target: "rail-tabs",
    title: "Evidence — check, don't trust",
    body:
      "Click any citation and the filing opens here with the exact words highlighted. This is the step that separates checking from believing.",
    side: "left",
    before: (a) => a.setTab("evidence"),
  },
  {
    target: "rail-tabs",
    title: "Decisions — the audit trail",
    body:
      "Every action by you and by the agent, in order, exportable as plain text. It records who decided what, and on what evidence.",
    side: "left",
    before: (a) => a.setTab("log"),
  },
  {
    target: "toollog",
    title: "Every WebMCP call, live",
    body:
      "The agent cannot touch this page except through these tools, and each one appears here as it runs. Read calls in teal, writes marked separately.",
    side: "top",
  },
  {
    target: "badge",
    title: "Bringing in an agent",
    body:
      "This says whether an agent can see the tools. Open Threadweaver in ChatGPT's browser, or Chrome 149+ with the WebMCP flag, and it turns on.",
    side: "bottom",
  },
  {
    title: "Read · Mark · Ask · Verify · Accept",
    body:
      "That is the whole loop. Start by reading the filing that is already open — and press ? in the top bar any time you want this again.",
    side: "center",
    before: (a) => {
      a.setWorkspace("read");
      a.setTab("details");
    },
  },
];
