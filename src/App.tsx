import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import GraphCanvas from "./canvas/GraphCanvas";
import { loadCorpus } from "./corpus/loadCorpus";
import DocumentQueue from "./reader/DocumentQueue";
import Reader from "./reader/Reader";
import DecisionLog from "./panels/DecisionLog";
import EnquiryPanel from "./panels/EnquiryPanel";
import EvidenceDrawer, { type EvidenceTarget } from "./panels/EvidenceDrawer";
import HowItWorks from "./panels/HowItWorks";
import Tour from "./tour/Tour";
import { introSeen, useTourStore } from "./tour/tourStore";
import Inspector from "./panels/Inspector";
import ProposalTray from "./panels/ProposalTray";
import SearchPanel from "./panels/SearchPanel";
import Settings from "./panels/Settings";
import ToolLog from "./panels/ToolLog";
import { openDocument, seedCanvas } from "./state/actions";
import { restoreMarkings, startMarkingPersistence } from "./state/persist";
import { useDecisionLog } from "./state/decisionLog";
import { openEnquiries, useEnquiryStore } from "./state/enquiryStore";
import { useGraphStore } from "./state/graphStore";
import { pendingProposals, useProposalStore } from "./state/proposalStore";
import { useReaderStore } from "./state/readerStore";
import StatusBadge from "./webmcp/StatusBadge";
import { ALL_TOOLS } from "./webmcp/tools";
import { Analytics } from "@vercel/analytics/react";

/**
 * Two workspaces, one shared rail.
 *
 * READ is the analyst's work surface and the app opens on it, because the
 * human reads first, see docs/METHOD.md. CANVAS is the shared picture. Both
 * stay mounted: switching is a view change, so no scroll position, selection or
 * simulation state is ever lost.
 *
 * The agent moves the analyst between them. `focus` switches to Canvas;
 * `open_document` and clicking a citation switch to Read.
 */

type Workspace = "read" | "canvas";
type Tab = "proposals" | "enquiries" | "evidence" | "details" | "log";

type BootState =
  | { phase: "loading" }
  | { phase: "ready"; fixture: boolean }
  | { phase: "failed"; error: string };

export default function App() {
  const [boot, setBoot] = useState<BootState>({ phase: "loading" });
  const [workspace, setWorkspace] = useState<Workspace>("read");
  const [tab, setTab] = useState<Tab>("details");
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const proposalMap = useProposalStore((s) => s.proposals);
  const enquiryMap = useEnquiryStore((s) => s.enquiries);
  const focusRequest = useGraphStore((s) => s.focusRequest);
  const scrollRequest = useReaderStore((s) => s.scrollRequest);
  const openDocId = useReaderStore((s) => s.openDocId);
  const decisions = useDecisionLog((s) => s.entries);

  const startTour = useTourStore((s) => s.start);
  const tourOpen = useTourStore((s) => s.open);

  /**
   * The tour drives the real interface, so it needs a handle on the same state
   * the chrome uses. Memoised: it is a dependency of the effect that runs each
   * step's `before`, and a fresh object every render would re-run it forever.
   */
  const tourApi = useMemo(
    () => ({ setWorkspace, setTab } as const),
    []
  );

  const pendingCount = useMemo(() => pendingProposals(proposalMap).length, [proposalMap]);
  const openCount = useMemo(() => openEnquiries(enquiryMap).length, [enquiryMap]);
  /**
   * What a screen reader is told when something arrives.
   *
   * Derived rather than pushed: the counts already exist, so there is no second
   * source of truth to keep in step, and a re-render cannot miss an event.
   */
  const announcement = useMemo(() => {
    const parts: string[] = [];
    if (pendingCount) parts.push(`${pendingCount} proposal${pendingCount === 1 ? "" : "s"} waiting for you`);
    if (openCount) parts.push(`${openCount} open line${openCount === 1 ? "" : "s"} of enquiry`);
    return parts.join(", ");
  }, [pendingCount, openCount]);

  useEffect(() => {
    let cancelled = false;
    loadCorpus()
      .then((corpus) => {
        if (cancelled) return;
        seedCanvas();

        // Marks from an earlier life of this tab, then the subscription that
        // keeps the store mirrored. Restore first so the subscription's first
        // write is the restored set rather than an empty one.
        const restored = restoreMarkings();
        startMarkingPersistence();
        if (restored) {
          useDecisionLog.getState()._push({
            id: `dec-restore-${Date.now()}`,
            at: Date.now(),
            actor: "human",
            action: "opened",
            detail: `restored ${restored} marking${restored === 1 ? "" : "s"} you made earlier in this tab`,
          });
        }

        setBoot({ phase: "ready", fixture: corpus.isFixture });

        // First visit ever, and only once the interface it describes exists.
        if (!introSeen()) startTour();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBoot({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [startTour]);

  /**
   * The agent staging its first proposal is the moment the whole product turns
   * on, and it used to happen behind an unselected tab. Pull focus once, only
   * on the transition from none to some, and never over the top of the analyst
   * reading a citation in the Evidence panel.
   */
  const hadProposals = useRef(false);
  useEffect(() => {
    const has = pendingCount > 0;
    if (has && !hadProposals.current && tab !== "evidence") setTab("proposals");
    hadProposals.current = has;
  }, [pendingCount, tab]);

  // Verification hook, inert unless asked for: exposes the registered tool
  // definitions on window so a test harness can stage a proposal exactly the
  // way a WebMCP host would call it, without needing a real host present.
  // Only runs with ?debugSim in the URL. See GraphCanvas.tsx for the
  // matching Simulation exposure this pairs with.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("debugSim")) {
      (window as unknown as { __tw_tools?: typeof ALL_TOOLS }).__tw_tools = ALL_TOOLS;
    }
  }, []);

  /**
   * Show a citation: open the filing in the reader at the right place *and*
   * fill the evidence panel. The analyst reads the record in context; the panel
   * says what it is being offered as evidence for.
   */
  const showEvidence = useCallback((target: EvidenceTarget) => {
    setEvidence(target);
    setTab("evidence");
    setWorkspace("read");
    openDocument(target.citation.doc_id, target.citation.span);
  }, []);

  // The agent pulling the analyst between workspaces.
  useEffect(() => {
    if (focusRequest) setWorkspace("canvas");
  }, [focusRequest]);

  useEffect(() => {
    if (scrollRequest) setWorkspace("read");
  }, [scrollRequest]);

  // A new proposal or result should not silently pile up behind a tab.
  useEffect(() => {
    if (pendingCount > 0) setTab("proposals");
  }, [pendingCount]);

  // Was bound to Tab, which meant focus could never move anywhere in the
  // app (WCAG 2.1.1), every Tab press was eaten here before it reached
  // anything focusable. W is unbound, unmodified, and matches the style of
  // F and Esc on the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key.toLowerCase() === "w" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setWorkspace((w) => (w === "read" ? "canvas" : "read"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (boot.phase === "loading") {
    return (
      <main className="boot">
        <div className="boot-card">
          <h1>Threadweaver</h1>
          <p className="lede">Loading the corpus…</p>
        </div>
      </main>
    );
  }

  if (boot.phase === "failed") {
    return (
      <main className="boot">
        <div className="boot-card">
          <h1>Threadweaver</h1>
          <p className="lede">The corpus could not be loaded.</p>
          <pre className="filing-text">{boot.error}</pre>
          <p className="foot">
            Run <code>npm run corpus:fetch</code> then <code>npm run corpus:build</code>.
            See <code>docs/DATA.md</code>.
          </p>
        </div>
      </main>
    );
  }

  /**
   * Rail order is a claim about what you touch most, and the old one was wrong.
   *
   * Details went first because it is the only panel that answers to what you
   * click, and because it holds the connect form. The one control a person
   * uses to draw their own edge. Burying that in fourth position meant nobody
   * found it without being told. Proposals still takes focus by itself the
   * moment one arrives (see the effect below), so nothing from the agent is
   * missed by demoting it one place.
   *
   * `hint` is what the tab is FOR, in one line, shown under the panel heading.
   * Five nouns in a row explain nothing to someone who has never seen this.
   */
  const tabs: { id: Tab; label: string; badge?: number; hint: string }[] = [
    {
      id: "details",
      label: "Details",
      hint: "What you have selected. And where you draw your own connection between two nodes.",
    },
    {
      id: "proposals",
      label: "Proposals",
      badge: pendingCount,
      hint: "What the agent is suggesting. Nothing here is on the canvas until you accept it.",
    },
    {
      id: "enquiries",
      label: "Enquiries",
      badge: openCount,
      hint: "Questions you have asked, in your words. The agent works this queue; only you close one.",
    },
    {
      id: "evidence",
      label: "Evidence",
      hint: "The filing behind a citation, with the exact words highlighted. Check rather than trust.",
    },
    {
      id: "log",
      label: "Decisions",
      badge: decisions.length,
      hint: "Every action by you and by the agent, in order. Exportable as plain text.",
    },
  ];

  const activeHint = tabs.find((t) => t.id === tab)?.hint;


  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          {/* The page's only h1. Visible text stays the product name; the
              hidden remainder gives a screen reader the sentence a sighted
              user gets from the whole screen at a glance. */}
          <h1 className="brand-name">
            Threadweaver
            <span className="sr-only">
              : an investigative graph canvas over UK Companies House records
            </span>
          </h1>
        </div>

        <nav className="workspace-switch" aria-label="Workspace" data-tour="workspace">
          <button
            className={workspace === "read" ? "on" : ""}
            onClick={() => setWorkspace("read")}
            aria-pressed={workspace === "read"}
          >
            Read
          </button>
          <button
            className={workspace === "canvas" ? "on" : ""}
            onClick={() => setWorkspace("canvas")}
            aria-pressed={workspace === "canvas"}
          >
            Canvas
          </button>
        </nav>

        <span className="tagline">
          UK Companies House public records · structure, not accusation
        </span>

        <span data-tour="badge">
          <StatusBadge />
        </span>

        <button
          className="icon-btn help-btn"
          onClick={startTour}
          aria-label="Show the introduction again"
          title="How Threadweaver works. Replay the introduction"
        >
          ?
        </button>

        <div className="settings-anchor">
          <button
            className={`settings-button ${settingsOpen ? "on" : ""}`}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            title="Settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden focusable="false">
              <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.6 2.2" />
            </svg>
          </button>
          {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
        </div>

        {boot.fixture && (
          <span className="fixture-warning" title="public/corpus/ is missing">
            DEV FIXTURE: not real records
          </span>
        )}
      </header>

      <HowItWorks />

      <div className="main">
        <aside
          className="rail-left"
          data-tour="rail-left"
          aria-label={workspace === "read" ? "Filings" : "Corpus search"}
        >
          {workspace === "read" ? <DocumentQueue /> : <SearchPanel />}
        </aside>

        <main className="stage">
          {/* Both mounted; only one shown. Switching loses nothing. */}
          <div className={`pane ${workspace === "read" ? "show" : ""}`}>
            <Reader />
          </div>
          <div className={`pane ${workspace === "canvas" ? "show" : ""}`}>
            <GraphCanvas />
          </div>
        </main>

        <aside className="rail-right" aria-label="Panels">
          <div className="tabs" role="tablist" aria-label="Panels" data-tour="rail-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                role="tab"
                type="button"
                className={tab === t.id ? "on" : ""}
                onClick={() => setTab(t.id)}
                aria-selected={tab === t.id}
                aria-controls="rail-panel"
                // Only the active tab is in the tab order; arrow keys move
                // between them, which is what a tablist is supposed to do.
                tabIndex={tab === t.id ? 0 : -1}
                onKeyDown={(e) => {
                  const i = tabs.findIndex((x) => x.id === tab);
                  const go = (n: number) => {
                    e.preventDefault();
                    const next = tabs[(n + tabs.length) % tabs.length];
                    setTab(next.id);
                    document.getElementById(`tab-${next.id}`)?.focus();
                  };
                  if (e.key === "ArrowRight") go(i + 1);
                  if (e.key === "ArrowLeft") go(i - 1);
                  if (e.key === "Home") go(0);
                  if (e.key === "End") go(tabs.length - 1);
                }}
              >
                {t.label}
                {t.badge ? (
                  <span className="tab-badge">
                    <span aria-hidden="true">{t.badge}</span>
                    <span className="sr-only">, {t.badge} waiting</span>
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {activeHint && <p className="rail-hint">{activeHint}</p>}

          <div className="rail-body" id="rail-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "proposals" && <ProposalTray onShowEvidence={showEvidence} />}
            {tab === "enquiries" && <EnquiryPanel onShowEvidence={showEvidence} />}
            {tab === "evidence" && (
              <EvidenceDrawer target={evidence} onClose={() => setEvidence(null)} />
            )}
            {tab === "details" && <Inspector onShowEvidence={showEvidence} />}
            {tab === "log" && <DecisionLog />}
          </div>
        </aside>
      </div>

      {/* Arrivals. A proposal appearing is the product's central event and it
          was completely silent; one polite region covers all three sources. */}
      <p className="sr-only" role="status">
        {announcement}
      </p>

      <ToolLog />

      {tourOpen && <Tour api={tourApi} />}

      <footer className="statusbar">
        <span className="dim">
          {workspace === "read" ? (
            <>
              Select a passage and press <kbd>1</kbd>-<kbd>6</kbd> to mark it ·{" "}
              {openDocId ? "reading" : "no filing open"}
            </>
          ) : (
            <>
              Click a node to select · drag to move · scroll to zoom · <kbd>F</kbd> frames ·{" "}
              <kbd>Esc</kbd> clears
            </>
          )}
        </span>
        <span className="dim">
          <kbd>W</kbd> switches workspace
        </span>
      </footer>

      <Analytics />
    </div>
  );
}
