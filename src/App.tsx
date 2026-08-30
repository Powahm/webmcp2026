import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import GraphCanvas from "./canvas/GraphCanvas";
import { loadCorpus } from "./corpus/loadCorpus";
import DocumentQueue from "./reader/DocumentQueue";
import Reader from "./reader/Reader";
import DecisionLog from "./panels/DecisionLog";
import EnquiryPanel from "./panels/EnquiryPanel";
import EvidenceDrawer, { type EvidenceTarget } from "./panels/EvidenceDrawer";
import Inspector from "./panels/Inspector";
import ProposalTray from "./panels/ProposalTray";
import SearchPanel from "./panels/SearchPanel";
import ToolLog from "./panels/ToolLog";
import { openDocument, seedCanvas } from "./state/actions";
import { useDecisionLog } from "./state/decisionLog";
import { openEnquiries, useEnquiryStore } from "./state/enquiryStore";
import { useGraphStore } from "./state/graphStore";
import { pendingProposals, useProposalStore } from "./state/proposalStore";
import { useReaderStore } from "./state/readerStore";
import { ALL_TOOLS } from "./webmcp/tools";

/**
 * Two workspaces, one shared rail.
 *
 * READ is the analyst's work surface and the app opens on it, because the
 * human reads first — see docs/METHOD.md. CANVAS is the shared picture. Both
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
  const [tab, setTab] = useState<Tab>("proposals");
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);

  const proposalMap = useProposalStore((s) => s.proposals);
  const enquiryMap = useEnquiryStore((s) => s.enquiries);
  const focusRequest = useGraphStore((s) => s.focusRequest);
  const scrollRequest = useReaderStore((s) => s.scrollRequest);
  const openDocId = useReaderStore((s) => s.openDocId);
  const decisions = useDecisionLog((s) => s.entries);

  const pendingCount = useMemo(() => pendingProposals(proposalMap).length, [proposalMap]);
  const openCount = useMemo(() => openEnquiries(enquiryMap).length, [enquiryMap]);

  useEffect(() => {
    let cancelled = false;
    loadCorpus()
      .then((corpus) => {
        if (cancelled) return;
        seedCanvas();
        setBoot({ phase: "ready", fixture: corpus.isFixture });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBoot({ phase: "failed", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Tab") {
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

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "proposals", label: "Proposals", badge: pendingCount },
    { id: "enquiries", label: "Enquiries", badge: openCount },
    { id: "evidence", label: "Evidence" },
    { id: "details", label: "Details" },
    { id: "log", label: "Decisions", badge: decisions.length },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Threadweaver</span>
        </div>

        <nav className="workspace-switch" aria-label="Workspace">
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

        <span className="tool-badge" title={ALL_TOOLS.map((t) => t.name).join("\n")}>
          {ALL_TOOLS.length} WebMCP tools
        </span>

        {boot.fixture && (
          <span className="fixture-warning" title="public/corpus/ is missing">
            DEV FIXTURE — not real records
          </span>
        )}
      </header>

      <div className="main">
        <aside className="rail-left">
          {workspace === "read" ? <DocumentQueue /> : <SearchPanel />}
        </aside>

        <section className="stage">
          {/* Both mounted; only one shown. Switching loses nothing. */}
          <div className={`pane ${workspace === "read" ? "show" : ""}`}>
            <Reader />
          </div>
          <div className={`pane ${workspace === "canvas" ? "show" : ""}`}>
            <GraphCanvas />
          </div>
        </section>

        <aside className="rail-right">
          <div className="tabs" role="tablist" aria-label="Panels">
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

      <ToolLog />

      <footer className="statusbar">
        <span className="dim">
          {workspace === "read" ? (
            <>
              Select a passage and press <kbd>1</kbd>–<kbd>6</kbd> to mark it ·{" "}
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
          <kbd>Tab</kbd> switches workspace
        </span>
      </footer>
    </div>
  );
}
