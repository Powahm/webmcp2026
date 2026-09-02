# Desk Two

A small computer in a browser tab. Two folders, two apps, no framework and no build step —
open `index.html` and it runs.

- **Readme** — a folder of documentation about the machine.
- **Scripts** — example programs and a blank one, in an editor that runs them.
- **Camera** — live preview, one button to record.
- **Editor** — a timeline. Trim, grade, reorder, export.

Anything the apps can do, a script can do without you clicking.

## Run it

```bash
open index.html          # that's it
# or, to get a secure context for the camera
python3 -m http.server   # then visit http://localhost:8000
```

The camera needs a **secure context**: `https://` or `localhost`. Opening the file over
`file://` gives you everything except live capture — use **Import video** instead.

## Files

| File | Contents |
|---|---|
| `index.html` | Menubar, desktop, dock, launcher |
| `styles.css` | Design tokens, both themes, window and app chrome |
| `store.js` | IndexedDB persistence for clips and scripts, plus clip probing |
| `shell.js` | Window manager, dock, ⌘K launcher, theme, icons |
| `camera.js` | Stream acquisition and recording |
| `editor.js` | Timeline, playback, grading, canvas export |
| `scripts-app.js` | Script folder, code editor, and the runtime API |
| `main.js` | Readme documents, app registration, boot |

Scripts load in that order; each attaches one global (`Store`/`Clips`, `Desk`, `Camera`,
`Editor`, `Scripts`, `Readme`).

## The scripting API

Scripts are ordinary async JavaScript handed an `api` object and a `log()` function.

```js
const clip = await api.camera.record(3);
await api.editor.open();
await api.editor.add(clip);
api.editor.trim(0.5, 2.5);
api.editor.look("punch");
api.editor.speed(1.5);
```

| Group | Calls |
|---|---|
| `api.clips` | `all()`, `last()`, `remove(id)` |
| `api.camera` | `record(seconds)`, `open()` |
| `api.editor` | `open()`, `add(clip)`, `trim(in, out)`, `look(name)`, `speed(n)`, `clear()`, `export()` |
| misc | `api.sleep(ms)`, `api.toast(msg)`, `api.timecode(seconds)` |

Looks are `none`, `mono`, `warm`, `cool`, `punch`, `faded`. Speeds are `0.5`, `1`, `1.5`, `2`.

Scripts are built with the `Function` constructor, so a page served under a CSP without
`unsafe-eval` will refuse to run them. The editor detects that at load, says so, and still
saves your code.

## How export works

There is no encoder dependency. Export replays the timeline into a `<canvas>`, applying each
clip's filter as `ctx.filter`, captures that canvas with `captureStream()`, mixes the audio
back in through a Web Audio graph, and records the combined stream with `MediaRecorder`.

The consequence: **rendering is real time.** A forty-second cut takes forty seconds.

Exports are saved back into the library as a new clip *and* offered as a download. The library
copy is the reliable one — some embedded frames block downloads a page starts itself.

## Storage

Clips and scripts live in IndexedDB under the origin serving the page. Nothing is uploaded;
there is no backend. If IndexedDB is unavailable the apps fall back to memory for the session,
so nothing breaks, but a refresh loses the library.

## Interactions

- **Click an icon** — folders hinge open, apps press in; the window scales out of the icon's
  exact rectangle and reverses back into it on close.
- **Drag** a window by its title bar, **resize** from the bottom-right, **double-click** to maximise.
- **⌘K / Ctrl+K** searches documents, scripts and clips.
- **Escape** closes the top window. **⌘Enter** runs a script, **⌘S** saves it.

## Accessibility

Icons and files are real buttons, windows are labelled dialogs, focus moves into a window on
open and back to the icon on close. `prefers-reduced-motion` disables the window animations
and the wallpaper parallax.

## Licence

MIT.
