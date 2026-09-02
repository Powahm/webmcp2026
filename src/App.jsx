import { useEffect } from "react";
import Ghost from "./agent/Ghost.jsx";
import DeskFolders from "./folders/DeskFolders.jsx";
import GhostFolder from "./folders/GhostFolder.jsx";
import StatusBadge from "./webmcp/StatusBadge.jsx";

/**
 * The desktop chrome.
 *
 * This is the markup that used to live in index.html, moved into React
 * unchanged. Every class name, id and attribute is the same, because the
 * window manager in legacy/shell.js resolves these nodes by id and the
 * stylesheet targets them by class. Identical DOM is what makes the port
 * invisible.
 *
 * The windows themselves are still built imperatively by shell.js. That is
 * deliberate: dragging, z-order, focus and the open animation that flies a
 * window out of its icon's bounding rect are all direct DOM work, and they
 * already work. React owns the chrome and the new surfaces; the window manager
 * and the two apps keep the code that is already shipping.
 */

/** StrictMode mounts effects twice in development. Booting twice would register
 *  every app twice and paint two sets of icons. */
let booted = false;

export default function App() {
  useEffect(() => {
    if (booted) return;
    booted = true;

    // Dynamic, not static. shell.js resolves #desktop, #dock and #icons at
    // module evaluation time, so it cannot be imported before this markup is
    // in the document.
    (async () => {
      const { boot } = await import("./legacy/main.js");
      boot();

      const { registerTools } = await import("./webmcp/register.js");
      await registerTools();
    })();
  }, []);

  return (
    <>
      <header className="menubar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M5 8h6l2 2h6v8H5V8Z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-name">Desk Two</span>
        </div>

        <div className="menubar-right">
          <StatusBadge />
          <button className="chip" id="spotlight-open" aria-keyshortcuts="Meta+K Control+K">
            <span>Search</span>
            <kbd className="mono">⌘K</kbd>
          </button>
          <button
            className="chip icon-chip"
            id="theme-toggle"
            aria-label="Switch to dark theme"
            aria-pressed="false"
          >
            <svg className="ico-sun" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1 5.3 5.3" />
            </svg>
            <svg className="ico-moon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
            </svg>
          </button>
          <time className="clock mono" id="clock">
            --:--
          </time>
        </div>
      </header>

      <main className="desktop" id="desktop">
        <div className="doodles" aria-hidden="true">
          <svg className="doodle d1" viewBox="0 0 120 40">
            <path d="M4 22c14-20 26 16 40-2s26 14 40-6 26 6 32 2" />
          </svg>
          <svg className="doodle d2" viewBox="0 0 60 60">
            <path d="M30 4v52M4 30h52M11 11l38 38M49 11 11 49" />
          </svg>
          <svg className="doodle d3" viewBox="0 0 100 60">
            <path d="M6 50C6 18 34 6 62 20" />
            <path d="M50 12l14 7-9 12" />
          </svg>
          <svg className="doodle d4" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="30" />
            <circle cx="40" cy="40" r="18" />
          </svg>
        </div>

        <div className="icons" id="icons" />

        {/* Folders that were actually imported, and folders the agent says it
            has but nobody has opened yet. */}
        <DeskFolders />
        <GhostFolder />

        <p className="hint" id="hint">
          Record something in <b>Camera</b>, then cut it in <b>Editor</b>.{" "}
          <span className="hint-sub">Or open Scripts and let a program do it.</span>
        </p>
      </main>

      <nav className="dock" id="dock" aria-label="Open windows" hidden>
        <ul className="dock-list" id="dock-list" />
      </nav>

      <div className="toaster" id="toaster" aria-live="polite" />

      {/* The agent, once it has actually used the page. */}
      <Ghost />

      {/* The teleprompter. Markup only: scripts-app.js resolves #prompter by id
          and drives the scroll itself, so this must stay outside any window and
          keep every class it targets. */}
      <div className="prompter" id="prompter" hidden>
        <div className="prompter-scrim" data-close-prompter />
        <div className="prompter-panel" role="dialog" aria-modal="true" aria-label="Teleprompter">
          <header className="prompter-head">
            <span className="prompter-title" />
            <button className="btn btn-mini" data-act="prompt-camera">Open Camera</button>
            <button className="btn btn-mini" data-act="prompt-close" aria-label="Close teleprompter">Esc</button>
          </header>
          <div className="prompter-scroll" />
          <footer className="prompter-foot">
            <button className="btn btn-mini" data-act="prompt-slower" aria-label="Slower">−</button>
            <span className="prompter-speed mono">1.0×</span>
            <button className="btn btn-mini" data-act="prompt-faster" aria-label="Faster">+</button>
            <button className="btn btn-play" data-act="prompt-play" data-playing="true" aria-label="Pause">
              <svg className="ico-play" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5z" />
              </svg>
              <svg className="ico-pause" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.5 2.5h3v11h-3zM8.5 2.5h3v11h-3z" />
              </svg>
            </button>
          </footer>
        </div>
      </div>

      <div className="spotlight" id="spotlight" hidden>
        <div className="spotlight-scrim" data-close-spotlight />
        <div className="spotlight-panel" role="dialog" aria-modal="true" aria-label="Search">
          <div className="spotlight-field">
            <svg className="spotlight-ico" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
            <input
              id="spotlight-input"
              type="text"
              placeholder="Search docs, skills, scripts and clips…"
              autoComplete="off"
              spellCheck="false"
              aria-controls="spotlight-results"
            />
            <kbd className="mono">esc</kbd>
          </div>
          <ul className="spotlight-results" id="spotlight-results" role="listbox" aria-label="Results" />
        </div>
      </div>
    </>
  );
}
