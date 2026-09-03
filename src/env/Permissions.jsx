import { useCallback, useEffect, useRef, useState } from "react";
import {
  PERMISSIONS,
  framed,
  openInOwnTab,
  readPermissions,
  requestPermission,
  watchPermissions,
} from "./browser.js";

/**
 * The permissions this app needs, as five lights in the menubar.
 *
 * Everything Deskmate does that the browser can refuse is refused silently:
 * the camera does not start, the folder never appears, and the page carries on
 * looking exactly as it did. That is the worst possible failure for something
 * people are about to demonstrate to a room, and it is worse again in an
 * agent's browser, where a prompt may be answered on the person's behalf
 * before they have seen it.
 *
 * So the state is on the wall rather than behind a failure. Five lights, green
 * for granted, amber for not asked yet, red for refused, and each one asks for
 * itself when pressed. The asking is the browser's own prompt, because there
 * is no other kind: a page cannot grant itself a camera, and a panel that
 * pretended otherwise would be a lie with a nice border.
 */
export default function Permissions() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(() =>
    PERMISSIONS.map((p) => ({ ...p, state: "ask", why: "" }))
  );
  const [busy, setBusy] = useState(null);
  const [said, setSaid] = useState(null);
  const box = useRef(null);

  const refresh = useCallback(async () => setRows(await readPermissions()), []);

  useEffect(() => {
    refresh();
    // The person may allow the camera from the browser's own site settings,
    // which does not touch this page. Without this the lights would be right
    // only until the moment somebody acted on them.
    return watchPermissions(refresh);
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // The desktop closes the top window on Escape. Closing this panel is not
      // a reason to lose the window behind it.
      e.stopPropagation();
      setOpen(false);
    };
    const onDown = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  async function ask(id) {
    setBusy(id);
    setSaid(null);
    const result = await requestPermission(id);
    setBusy(null);
    setSaid({ id, ...result });
    refresh();
  }

  const off = rows.filter((r) => r.state === "off").length;
  const on = rows.filter((r) => r.state === "on").length;
  const worst = off ? "off" : on === rows.length ? "on" : "ask";

  return (
    <div className="perm-wrap" ref={box}>
      <button
        className="chip perm-chip"
        id="permissions"
        aria-expanded={open}
        aria-label={`Permissions: ${on} of ${rows.length} allowed${off ? `, ${off} refused` : ""}`}
        title="What this browser lets Deskmate do"
        data-worst={worst}
        onClick={() => setOpen((v) => !v)}
      >
        <svg className="perm-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none"
             stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
          <path d="M12 3.2 19 6v5.5c0 4.2-2.8 7.3-7 9.3-4.2-2-7-5.1-7-9.3V6z" />
        </svg>
        <span className="perm-orbs">
          {rows.map((r) => (
            <span key={r.id} className="perm-orb" data-state={r.state} aria-hidden="true" />
          ))}
        </span>
        <span className="perm-word">Permissions</span>
      </button>

      {open && (
        <div className="perm-panel" role="dialog" aria-label="Permissions">
          <p className="perm-lede">
            What this browser lets Deskmate do. Nothing here leaves your machine either way:
            these are what the page is allowed to reach, not what it sends.
          </p>

          <ul className="perm-list">
            {rows.map((r) => (
              <li className="perm-row" key={r.id} data-state={r.state}>
                <span className="perm-orb perm-orb--big" data-state={r.state} aria-hidden="true" />
                <span className="perm-main">
                  <span className="perm-name">
                    {r.name}
                    <span className="perm-state mono">
                      {r.state === "on" ? "allowed" : r.state === "off" ? "refused" : "not asked"}
                    </span>
                  </span>
                  <span className="perm-what">{r.what}</span>
                  <span className="perm-why">{said?.id === r.id ? said.message : r.why}</span>
                </span>
                {r.state !== "on" && (
                  <button
                    className="btn btn-mini perm-act"
                    disabled={busy === r.id}
                    onClick={() => ask(r.id)}
                  >
                    {busy === r.id ? "Asking…" : r.state === "off" ? "Recheck" : r.ask}
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="perm-foot">
            <button className="btn btn-mini" onClick={refresh}>Recheck all</button>
            {framed() && (
              <button
                className="btn btn-mini btn-accent"
                onClick={() => {
                  if (!openInOwnTab()) setSaid({ id: null, message: "This browser would not open a tab. Copy the address into one yourself." });
                }}
              >
                Open in its own tab
              </button>
            )}
          </div>
          {framed() && (
            <p className="perm-frame-note">
              Deskmate is running inside another page's frame. A frame only has the camera,
              the microphone and the folder picker if the page around it passed them down, and
              nothing in here can change that. Its own tab always can.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
