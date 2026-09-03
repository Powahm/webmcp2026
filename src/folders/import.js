import { addDeskFolder } from "./desk.js";
import { folderById, markImported } from "./offered.js";
import { framed } from "../env/browser.js";

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
// Some browsers hand back a blank `type` for a file read out of a directory
// handle, so the extension has to be able to answer on its own.
const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;

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

  // Silence here was the bug. Every way this can end without a folder now says
  // so: a picker the browser will not open, a cancelled dialog, and a folder
  // that turned out to be empty are three different things, and a person
  // staring at an unchanged desktop cannot tell them apart.
  if (chosen === CANCELLED) return null;
  if (chosen instanceof Error) {
    Desk.toast(pickerProblem(chosen), "bad");
    return null;
  }
  if (!chosen || chosen.length === 0) {
    Desk.toast("That folder came back empty.", "bad");
    return null;
  }

  const entries = [];
  const failed = [];
  for (const file of chosen) {
    // One unreadable file used to end the whole import, and because nothing
    // caught it the folder simply never appeared. Now it is listed as a file
    // that would not open and the rest still lands.
    try {
      if (file.type.startsWith("video/") || VIDEO_FILE.test(file.name)) {
        const clip = await Clips.save(file, { name: stem(file.name), kind: "import" });
        entries.push({ name: file.name, size: file.size, clipId: clip.id });
      } else if (file.type.startsWith("text/") || TEXT_FILE.test(file.name)) {
        const script = await saveScript(Store, file.name, await file.text());
        entries.push({ name: file.name, size: file.size, scriptId: script.id });
      }
      // Anything else is listed but not opened: an image or a project file is
      // worth seeing in the folder and is not something this app can act on.
      else entries.push({ name: file.name, size: file.size });
    } catch (err) {
      failed.push(file.name);
      entries.push({ name: file.name, size: file.size });
    }
  }

  const name = folderNameFrom(chosen);
  const folder = addDeskFolder({ name, files: entries });

  const clips = entries.filter((e) => e.clipId).length;
  const scripts = entries.filter((e) => e.scriptId).length;
  const bits = [];
  if (clips) bits.push(`${clips} clip${clips === 1 ? "" : "s"}`);
  if (scripts) bits.push(`${scripts} script${scripts === 1 ? "" : "s"}`);
  Desk.toast(bits.length ? `${bits.join(" and ")} in from ${name}` : `${name} is on your desk`, "good");
  if (failed.length) {
    Desk.toast(`${failed.length} file${failed.length === 1 ? "" : "s"} would not open: ${failed.slice(0, 3).join(", ")}`, "bad");
  }

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
 * Three outcomes, and they are deliberately three rather than one:
 * `CANCELLED` for a dialog the person closed, an `Error` for a picker the
 * browser refused to open, and an array for a folder. Collapsing all three into
 * null is what made a failed import look identical to a successful one that
 * changed nothing.
 *
 * showDirectoryPicker is the good path. The input fallback is for browsers, and
 * embedded frames, that do not expose it, and for the case this used to get
 * wrong: a browser that exposes it and then refuses to open it.
 */
export const CANCELLED = Symbol("cancelled");

/** What to say when neither picker would open. */
function pickerProblem(err) {
  const name = err?.name || "";
  if (name === "SecurityError" || name === "NotAllowedError") {
    return "This browser would not open a folder picker here. Open the page in its own tab and try again.";
  }
  return `Could not open the folder: ${err?.message || name || "unknown error"}`;
}

/**
 * Ask for a folder, by whichever of the two ways this browser allows.
 *
 * The File System Access picker is the better one where it works. It is also
 * the one that a page inside somebody else's frame is not allowed to open: the
 * function is there, calling it throws, and this used to report that as the end
 * of the matter. It is not. `<input webkitdirectory>` asks for the same folder
 * through a plain file input, which no permissions policy takes away, and since
 * this app only ever reads the files it loses nothing but the handle.
 *
 * So: in a frame, do not even try the one that will be refused, because the
 * failed attempt spends the click. Outside a frame, try it, and fall back to
 * the input on anything except the person closing the dialog themselves.
 */
function chooseFiles() {
  if (window.showDirectoryPicker && !framed()) {
    return window
      .showDirectoryPicker({ mode: "read" })
      .then(async (dir) => {
        const out = [];
        for await (const [, handle] of dir.entries()) {
          if (handle.kind === "file") out.push(await handle.getFile());
        }
        return out;
      })
      .catch((err) => (err?.name === "AbortError" ? CANCELLED : chooseByInput()));
  }

  return chooseByInput();
}

/** The folder, through a plain file input. */
function chooseByInput() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = "none";

    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener("change", () => finish([...input.files]));
    // Chrome fires this when the dialog is dismissed. Where it exists it is
    // exact, and it is why the focus fallback below can afford to be slow.
    input.addEventListener("cancel", () => finish(CANCELLED));

    // The old version resolved null 600ms after focus returned. On a folder
    // with any size to it the change event has not fired by then, so the
    // import was abandoned while the browser was still reading the directory,
    // which is exactly the "it just disappears" symptom. Give it real time, and
    // only give up if nothing was chosen.
    window.addEventListener(
      "focus",
      () => setTimeout(() => finish(input.files?.length ? [...input.files] : CANCELLED), 4000),
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

  let chosen = await picking;
  if (chosen === CANCELLED) chosen = null;
  if (chosen instanceof Error) {
    Desk.toast(pickerProblem(chosen), "bad");
    chosen = null;
  }
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
