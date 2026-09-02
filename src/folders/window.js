import { deskFolder } from "./desk.js";

/**
 * What came in, and what each thing can do next.
 *
 * A clip opens in the Editor, a script opens in Scripts, and anything else is
 * listed and left alone. Imported dynamically, like everything that touches the
 * legacy modules, because shell.js resolves #desktop the moment it loads.
 */
export async function openDeskFolder(id) {
  const folder = deskFolder(id);
  if (!folder) return;

  const { Desk } = await import("../legacy/shell.js");
  const { Editor } = await import("../legacy/editor.js");
  const { Scripts } = await import("../legacy/scripts-app.js");
  const { Store } = await import("../legacy/store.js");

  Desk.openWindow({
    id: `folder:${folder.id}`,
    title: folder.name,
    meta: `${folder.files.length} items`,
    tint: "#30ABC6",
    size: { w: 640, h: 480 },
    build(body) {
      body.className = "win-body";
      const grid = document.createElement("div");
      grid.className = "filegrid spill";
      grid.innerHTML = folder.files
        .map((f, i) => {
          const usable = f.clipId || f.scriptId;
          return `
            <button class="file ${usable ? "" : "file--inert"}" style="--i:${i}; --f-accent:${
            f.clipId ? "#B62AD9" : f.scriptId ? "#F7A501" : "#8B8B83"
          }"
              ${f.clipId ? `data-clip="${f.clipId}"` : ""}
              ${f.scriptId ? `data-script="${f.scriptId}"` : ""}
              ${usable ? "" : "disabled"}>
              <span class="file-art" aria-hidden="true"></span>
              <span class="file-name">${Desk.esc(f.name)}</span>
              <span class="file-kind">${f.clipId ? "open in Editor" : f.scriptId ? "open in Scripts" : f.kind}</span>
            </button>`;
        })
        .join("");

      grid.addEventListener("click", async (e) => {
        const clip = e.target.closest("[data-clip]");
        if (clip) return void Editor.openWith(clip.dataset.clip);
        const script = e.target.closest("[data-script]");
        if (script) {
          const found = (await Store.all("scripts")).find((s) => s.id === script.dataset.script);
          if (found) Scripts.openScript(found, script.getBoundingClientRect());
        }
      });

      body.appendChild(grid);
    },
  });
}
