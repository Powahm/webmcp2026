import { useEffect, useState } from "react";
import "./App.css";
import GraphCanvas from "./canvas/GraphCanvas";
import { loadCorpus } from "./corpus/loadCorpus";
import EvidenceDrawer, { type EvidenceTarget } from "./panels/EvidenceDrawer";
import Inspector from "./panels/Inspector";
import ProposalTray from "./panels/ProposalTray";
import SearchPanel from "./panels/SearchPanel";
import ToolLog from "./panels/ToolLog";
import { seedCanvas } from "./state/actions";

/**
 * Layout, per docs/UI-3D.md: canvas left, panels right, tool log along the
 * bottom. The 3D layer is spatial; the 2D panels are evidential.
 */

type BootState =
  | { phase: "loading" }
  | { phase: "ready"; fixture: boolean }
  | { phase: "failed"; error: string };

export default function App() {
  const [boot, setBoot] = useState<BootState>({ phase: "loading" });
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);

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

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Threadweaver</span>
        <span className="tagline">
          UK Companies House public records · structure, not accusation
        </span>
        {boot.fixture && (
          <span className="fixture-warning" title="public/corpus/ is missing">
            DEV FIXTURE — not real records
          </span>
        )}
      </header>

      <div className="main">
        <GraphCanvas />

        <aside className="side">
          <SearchPanel />
          <ProposalTray onShowEvidence={setEvidence} />
          <Inspector onShowEvidence={setEvidence} />
          <EvidenceDrawer target={evidence} onClose={() => setEvidence(null)} />
        </aside>
      </div>

      <ToolLog />

      <footer className="toolbar-bottom">
        <span className="dim">
          Click a node to select · click a second to select both · F frames the
          selection · Esc clears it · right-click a node to fly to it
        </span>
      </footer>
    </div>
  );
}
