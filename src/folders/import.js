import { addDeskFolder } from "./desk.js";
import { folderById, markImported } from "./offered.js";

/**
 * Letting a folder in.
 *
 * Two paths, and the difference is not cosmetic:
 *
 *   - text the agent already sent lands straight away, because a script fits
 *     down a tool call;
 *   - everything else needs the browser's own directory picker, because bytes
 *     do not, and because the page has no business reading a disk it was not
 *     pointed at.
 *
 * Nothing from src/legacy is imported at the top of this file. shell.js
 * resolves #desktop the moment it is evaluated, and a static import here would
 * drag it in through App.jsx before React has rendered the chrome. Same reason
 * boot() is called from an effect rather than at module scope.
 *
 * The picker is opened from a click and nowhere else, and before any await, so
 * the user gesture is still live when it runs. There is no tool that imports a
 * folder, only one that offers it.
 */

const TEXT_FILE = /\.(txt|md|markdown|srt|vtt)$/i;

/** Split a plain text file into the app's line-per-beat script model. */
function linesFrom(text) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const source = paragraphs.length > 1
    ? paragraphs
    : String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  return (source.length ? source : [""]).map((t) => ({ text: t, note: "" }));
}

const stem = (name) => name.replace(/\.[^.]+$/, "");

async function saveScript(Store, name, text) {
  const script = {
    id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: stem(name).slice(0, 80) || "Imported script",
    lines: linesFrom(text),
    sources: "",
    created: Date.now(),
    updated: Date.now(),
  };
  await Store.put("scripts", script);
  return script;
}

/**
 * The person asks for a folder themselves.
 *
 * No agent involved, and no manifest: they press the button, the browser opens
 * its picker, and what comes back lands on the desktop as a folder they can
 * open. This is the path that actually gets used, because the agent has no
 * reason to volunteer a folder it was never asked about.
 */
export async function pickFolderOntoDesk() {
  // Before any await, so the click is still the current user activation.
  const picking = chooseFiles();

  const { Store, Clips } = await import("../legacy/store.js");
  const { Desk } = await import("../legacy/shell.js");

  const chosen = await picking;
  if (!chosen || chosen.length === 0) return null;

  const entries = [];
  for (const file of chosen) {
    if (file.type.startsWith("video/")) {
      const clip = await Clips.save(file, { name: stem(file.name), kind: "import" });
      entries.push({ name: file.name, size: file.size, clipId: clip.id });
    } else if (file.type.startsWith("text/") || TEXT_FILE.test(file.name)) {
      const script = await saveScript(Store, file.name, await file.text());
      entries.push({ name: file.name, size: file.size, scriptId: script.id });
    }
    // Anything else is listed but not opened: an image or a project file is
    // worth seeing in the folder and is not something this app can act on.
    else entries.push({ name: file.name, size: file.size });
  }

  const name = folderNameFrom(chosen);
  const folder = addDeskFolder({ name, files: entries });

  const clips = entries.filter((e) => e.clipId).length;
  const scripts = entries.filter((e) => e.scriptId).length;
  const bits = [];
  if (clips) bits.push(`${clips} clip${clips === 1 ? "" : "s"}`);
  if (scripts) bits.push(`${scripts} script${scripts === 1 ? "" : "s"}`);
  Desk.toast(bits.length ? `${bits.join(" and ")} in from ${name}` : `${name} is on your desk`, "good");

  // Show them what arrived. The icon lands on the desktop behind whatever
  // window they already had open, so without this the only sign anything
  // happened is a toast that has already started fading.
  const { openDeskFolder } = await import("./window.js");
  openDeskFolder(folder.id);

  return folder;
}

/** The directory's own name, from whatever the picker gave us. */
function folderNameFrom(files) {
  const path = files[0]?.webkitRelativePath || "";
  const first = path.split("/")[0];
  return first || "Imported";
}

/**
 * Ask for the folder.
 *
 * showDirectoryPicker is the good path. The input fallback is for browsers, and
 * embedded frames, that do not expose it; a cancelled input fires no event in
 * some of them, so the focus listener stops the promise hanging forever.
 */
function chooseFiles() {
  if (window.showDirectoryPicker) {
    return window
      .showDirectoryPicker({ mode: "read" })
      .then(async (dir) => {
        const out = [];
        for await (const [, handle] of dir.entries()) {
          if (handle.kind === "file") out.push(await handle.getFile());
        }
        return out;
      })
      .catch((err) => (err?.name === "AbortError" ? null : null));
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve([...input.files]);
      input.remove();
    });
    window.addEventListener(
      "focus",
      () => setTimeout(() => resolve(input.files?.length ? [...input.files] : null), 600),
      { once: true }
    );
    document.body.appendChild(input);
    input.click();
  });
}

/** The whole gesture: open the picker first, then do the slow work. */
export async function acceptFolder(id, gesture) {
  const folder = folderById(id);
  if (!folder) return;

  const needsPicker = folder.files.some((f) => f.kind !== "text" || !f.text);

  // Started before any await, so the click is still the current activation.
  const picking = needsPicker ? chooseFiles() : Promise.resolve(null);

  const { Store, Clips } = await import("../legacy/store.js");
  const { Desk } = await import("../legacy/shell.js");

  let scripts = 0;
  // Names that arrived with the offer, so the picker does not import them a
  // second time. The picker hands back the whole directory, text included, and
  // without this every script the agent sent lands twice.
  const alreadyIn = new Set();

  for (const file of folder.files) {
    if (file.kind === "text" && file.text) {
      await saveScript(Store, file.name, file.text);
      alreadyIn.add(file.name.toLowerCase());
      scripts += 1;
    }
  }
  if (scripts) Desk.toast(`${scripts} script${scripts === 1 ? "" : "s"} in from ${folder.name}`, "good");

  const chosen = await picking;
  let clips = 0;

  if (chosen) {
    // Only what was offered. A directory picker hands over everything in the
    // folder, and importing files nobody mentioned would be a surprise.
    const wanted = new Set(folder.files.map((f) => f.name.toLowerCase()));
    for (const file of chosen) {
      const key = file.name.toLowerCase();
      if (wanted.size && !wanted.has(key)) continue;
      if (alreadyIn.has(key)) continue;
      if (file.type.startsWith("video/")) {
        await Clips.save(file, { name: stem(file.name), kind: "import" });
        clips += 1;
      } else if (file.type.startsWith("text/") || TEXT_FILE.test(file.name)) {
        await saveScript(Store, file.name, await file.text());
        scripts += 1;
      }
    }
    const bits = [];
    if (clips) bits.push(`${clips} clip${clips === 1 ? "" : "s"}`);
    if (bits.length) Desk.toast(`${bits.join(" and ")} in from ${folder.name}`, "good");
  }

  if (scripts || clips) markImported(id, gesture, { scripts, clips });
  else Desk.toast("Nothing imported.", "bad");
}
