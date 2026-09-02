import { useEffect, useState } from "react";
import { deskFolders, onDeskFolders } from "./desk.js";

/**
 * Folders someone imported this session, sitting on the desktop.
 *
 * Solid, not ghostly: unlike an offer, these have actually been read. Opening
 * one lists what came in and hands each file to whichever app can do something
 * with it.
 */
export default function DeskFolders() {
  const [folders, setFolders] = useState(deskFolders);
  useEffect(() => onDeskFolders(() => setFolders(deskFolders())), []);
  if (folders.length === 0) return null;

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
    </div>
  );
}
