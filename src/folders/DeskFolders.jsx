import { useEffect, useState } from "react";
import { deskFolders, onDeskFolders } from "./desk.js";

/**
 * Folders someone imported this session, sitting on the desktop.
 *
 * Solid, not ghostly: unlike an offer, these have actually been read. Opening
 * one lists what came in and hands each file to whichever app can do something
 * with it.
 *
 * The **Add a folder** tile is always here, and that is the point of it. The
 * ghost asks once, and someone who says "not now" then has no way back: a
 * question you can only answer at the moment it is asked is not really an
 * offer. So the desk keeps one dashed folder open at all times.
 */
export default function DeskFolders() {
  const [folders, setFolders] = useState(deskFolders);
  const [busy, setBusy] = useState(false);
  useEffect(() => onDeskFolders(() => setFolders(deskFolders())), []);

  // Loaded up front so the click that opens the picker is not spent waiting on
  // a module: showDirectoryPicker needs the user activation to still be live.
  const [pick, setPick] = useState(null);
  useEffect(() => {
    let live = true;
    import("./import.js").then((m) => { if (live) setPick(() => m.pickFolderOntoDesk); });
    return () => { live = false; };
  }, []);

  return (
    <div className="desk-folders">
      {folders.map((f) => {
        const clips = f.files.filter((x) => x.clipId).length;
        const scripts = f.files.filter((x) => x.scriptId).length;
        const bits = [];
        if (clips) bits.push(`${clips} clip${clips === 1 ? "" : "s"}`);
        if (scripts) bits.push(`${scripts} script${scripts === 1 ? "" : "s"}`);
        return (
          <button
            key={f.id}
            className="desk-folder"
            onClick={async () => {
              const { openDeskFolder } = await import("./window.js");
              openDeskFolder(f.id);
            }}
          >
            <svg viewBox="0 0 96 74" aria-hidden="true">
              <path d="M2 12a6 6 0 0 1 6-6h24l8 8h48a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6z" />
            </svg>
            <span className="desk-folder-name">{f.name}</span>
            <span className="desk-folder-sub mono">{bits.join(", ") || `${f.files.length} files`}</span>
          </button>
        );
      })}

      <button
        className="desk-folder desk-folder--add"
        data-add-folder
        disabled={!pick || busy}
        onClick={() => {
          if (!pick) return;
          setBusy(true);
          // Not awaited: the picker has to open inside this click, and the
          // import that follows it reports itself in toasts.
          Promise.resolve(pick()).finally(() => setBusy(false));
        }}
      >
        <svg viewBox="0 0 96 74" aria-hidden="true">
          <path d="M2 12a6 6 0 0 1 6-6h24l8 8h48a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6z" />
          <path className="desk-folder-plus" d="M48 30v24M36 42h24" />
        </svg>
        <span className="desk-folder-name">{busy ? "Choosing…" : "Add a folder"}</span>
        <span className="desk-folder-sub mono">videos and scripts</span>
      </button>
    </div>
  );
}
