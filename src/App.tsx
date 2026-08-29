import { useEffect, useState } from "react";
import "./App.css";

/**
 * Step 1 shell. The real layout — canvas left, panels right, tool log along the
 * bottom (docs/UI-3D.md) — lands in step 3. This exists so there is something
 * honest on the deployed URL while the registration gate is verified.
 */
export default function App() {
  const [host, setHost] = useState<string>("checking…");

  useEffect(() => {
    if (document.modelContext?.registerTool) setHost("document.modelContext");
    else if (navigator.modelContext?.registerTool) setHost("navigator.modelContext");
    else setHost("none — running as a normal web app");
  }, []);

  return (
    <main className="boot">
      <div className="boot-card">
        <h1>Threadweaver</h1>
        <p className="lede">
          An investigative graph canvas where a human and an AI agent build the same
          picture together, over real UK Companies House public records.
        </p>
        <dl className="kv">
          <dt>WebMCP host</dt>
          <dd className={host.startsWith("none") ? "dim" : "ok"}>{host}</dd>
          <dt>Tools registered</dt>
          <dd>1 — <code>get_page_title</code></dd>
          <dt>Build stage</dt>
          <dd className="dim">1 of 5 — registration gate</dd>
        </dl>
        <p className="foot">
          Open the <strong>Site tools</strong> panel in the address bar. If
          <code> get_page_title</code> is listed, the gate is passed.
        </p>
      </div>
    </main>
  );
}
