import { useEffect, useState } from "react";
import { acceptFolder } from "./import.js";
import { dismiss, offeredFolders, onFolders, summarise } from "./offered.js";

/**
 * A folder the agent says it has, drawn as something not quite here yet.
 *
 * It is deliberately translucent and dashed, the same language every other
 * unconfirmed thing in this app uses, because nothing has been read yet. What
 * you are looking at is a claim: the agent listed these files, and the page has
 * taken its word for it. Hovering says what would come in; clicking is the
 * authorisation, and the browser's own picker is what actually opens the door.
 */
export default function GhostFolder() {
  const [folders, setFolders] = useState(offeredFolders);
  const [busy, setBusy] = useState(null);

  useEffect(() => onFolders(() => setFolders(offeredFolders())), []);
  if (folders.length === 0) return null;

  return (
    <div className="ghost-folders">
      {folders.map((f) => {
        const sum = summarise(f);
        const instant = f.files.filter((x) => x.kind === "text" && x.text).length;
        return (
          <div className="ghost-folder" key={f.id}>
            <button
              className="ghost-folder-art"
              disabled={busy === f.id}
              aria-label={`Import ${f.name}, ${sum.text}`}
              onClick={async (e) => {
                setBusy(f.id);
                try {
                  await acceptFolder(f.id, e);
                } finally {
                  setBusy(null);
                }
              }}
            >
              <svg viewBox="0 0 96 74" aria-hidden="true">
                <path d="M2 12a6 6 0 0 1 6-6h24l8 8h48a6 6 0 0 1 6 6v48a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6z" />
              </svg>
              <span className="ghost-folder-name">{f.name}</span>
              <span className="ghost-folder-sub mono">{busy === f.id ? "opening…" : sum.text}</span>
            </button>

            <div className="ghost-folder-pop" role="note">
              <p className="ghost-folder-lede">
                The agent says it has <b>{f.name}</b>.
              </p>
              <ul className="ghost-folder-files">
                {f.files.slice(0, 5).map((file) => (
                  <li key={file.name}>
                    <span className={`ghost-folder-kind ${file.kind}`} aria-hidden="true" />
                    <span className="mono">{file.name}</span>
                  </li>
                ))}
                {f.files.length > 5 && <li className="ghost-folder-more">and {f.files.length - 5} more</li>}
              </ul>
              {f.reason && <p className="ghost-folder-why">{f.reason}</p>}
              <p className="ghost-folder-note">
                {instant > 0
                  ? `${instant} script${instant === 1 ? "" : "s"} came with the offer and land straight away. `
                  : ""}
                Everything else needs you to point the browser at the folder. Nothing is read
                until you do.
              </p>
              <button className="btn btn-mini btn-danger" onClick={(e) => dismiss(f.id, e)}>
                Not this one
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
