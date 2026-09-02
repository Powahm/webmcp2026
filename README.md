# Desk Two

A small computer in a browser tab. Three folders, two apps, no framework and no build step —
open `index.html` and it runs.

- **Readme** — documentation about the machine.
- **Scripts** — what you are going to say on camera, with a teleprompter.
- **Skills** — craft notes on cutting, pacing and looks.
- **Camera** — live preview, one button to record.
- **Editor** — a timeline. Trim, grade, reorder, export.

Write the script, read it off the prompter while you record, then cut what you shot.

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
| `scripts-app.js` | Script folder, line editor, teleprompter |
| `skills.js` | Craft notes; the style ones apply to the timeline |
| `main.js` | Readme documents, app registration, boot |

Scripts load in that order; each attaches one global (`Store`/`Clips`, `Desk`, `Camera`,
`Editor`, `Scripts`, `Skills`, `Readme`).

## Scripts

A script is a title and a list of lines. Each line carries the **spoken text** and an optional
**shot direction** — where the camera is, what the b-roll is, what the tone should be.

Runtime is estimated at 2.5 words per second (about 150 wpm, an unhurried speaking pace) and
totalled across the script. The teleprompter scrolls the whole thing across roughly that
runtime, brightening the line you should be on, with speed control while it runs.

Scripts saved by the earlier code-based version are migrated on boot: each non-empty source
line becomes a spoken line, so nothing is lost.

## Skills

Short craft notes in three kinds — `cut`, `edit` and `style`. The style notes carry an
**Apply** button that sets that look and speed on the last clip on the timeline, so the
reference is usable rather than only readable.

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
