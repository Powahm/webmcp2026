# CLAUDE.md

> **Never commit this file.** Do not commit `CLAUDE.md` or `hackathon-strategy.md` to GitHub.
> Edit `CLAUDE.md` freely — just leave the change uncommitted and out of any staged diff.
>
> One exception already happened, on purpose: this file was committed once so the design
> system below travels with the repo. That is why you will find it tracked. Do not "fix" that
> by deleting it from the repo, and do not commit any further changes to it.

Project notes for Claude. `README.md` documents the code; this file documents the taste.

## Commits

One line. Short. Conventional Commits. No body unless I ask for one.

```
<type>: <what changed, lowercase, imperative>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `style`, `build`, `ci`

**Good:**

```
feat: scaffold vite app and register first webmcp tool
fix: read all parts of the bulk csv, not just the first
refactor: move span logic into textbuilder
docs: document no-commit-tool guarantee and scope decisions
```

**Bad — this is what I do not want:**

```
Step 3: 3D canvas, corpus loader, and manual investigation with no agent

The app is now a working tool on its own. Search the corpus, add an entity,
and every corpus edge whose other end is already on the canvas comes with it...
[20 more lines]

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/...
```

**Rules:**

- Never add `Co-Authored-By`, `Claude-Session`, `Generated with`, or any other AI attribution trailer. Not in commits, not in PR descriptions.
- No "Step 1:", "Step 2:" prefixes. The commit is not a task list.
- Don't explain the reasoning in the message. If it's worth explaining, it goes in a code comment or in the README.
- Under ~70 characters for the subject line.

## Other

- Commit after each logical chunk of work, not at the end of everything.

---

# Design system

## What this is

**Desk Two** — a small computer in a browser tab. A menubar, a wallpaper, desktop icons, a
window manager and a dock. Two folders (**Readme**, **Scripts**) and two apps (**Camera**,
**Editor**), where clips you record can be cut on a timeline, and scripts can drive both apps.

The metaphor is a desktop operating system and it is load-bearing, not decorative. Everything
opens in a window you can drag, stack, resize, minimise and close. If a new feature does not
fit as an icon that opens a window, it probably does not belong.

## Visual direction

**We are going for a style similar to [posthog.com](https://posthog.com).** That means:

- Chunky 2px black borders on nearly everything.
- Hard offset drop shadows, never soft or blurred. `box-shadow: 6px 6px 0 var(--shadow)`.
- Warm cream ground rather than white, with a faint dot grid.
- Loud, saturated accent colours used as flat fills.
- Playful hand-drawn doodles on the wallpaper.
- Skeuomorphic press feedback — things physically move when you click them.
- Friendly and slightly retro, never corporate or glassy.

**Original work in that spirit, not a clone.** Do not copy PostHog's logo, their hedgehog
mascot, their typefaces, or their marketing copy. Take the register, write our own.

## Colour

All colour lives in CSS custom properties at the top of `styles.css`. Never hard-code a hex
value in a component rule — add or use a token.

### Light (bare `:root`)

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#EEEFE9` | Desktop wallpaper, page background |
| `--ground-2` | `#E4E5DC` | Recessed wells — script output, progress track |
| `--surface` | `#FBFBF7` | Window bodies, menubar, dock |
| `--surface-2` | `#F2F2EC` | Title bars, toolbars, buttons at rest |
| `--ink` / `--line` / `--shadow` | `#2F2F2F` | Borders and hard shadows. Warm near-black, not pure |
| `--text` | `#2F2F2F` | Body text |
| `--text-muted` | `#6B6B63` | Metadata, captions, placeholders |
| `--dot` | `#CFD0C6` | Wallpaper dot grid |
| `--accent` | `#F54E00` | **The one loud colour.** Primary buttons, record, selection |
| `--accent-soft` | `#FFE9DF` | Hover wash, chips, callouts |
| `--yellow` | `#F7A501` | Scripts folder, minimise button |
| `--yellow-dk` | `#C97F00` | Scripts folder back panel |
| `--teal` | `#30ABC6` | Readme folder, maximise button |
| `--teal-dk` | `#1F7E94` | Readme folder back panel |
| `--blue` | `#1D4AFF` | Links and focus rings only |
| `--purple` | `#B62AD9` | Editor app, timeline segments |

### Dark

Redefines the same tokens twice: under `@media (prefers-color-scheme: dark)` guarded as
`:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]` so the toggle
wins in both directions.

| Token | Hex |
|---|---|
| `--ground` | `#171922` |
| `--ground-2` | `#12141B` |
| `--surface` | `#2B2F3D` |
| `--surface-2` | `#232735` |
| `--ink` / `--line` / `--shadow` | `#0A0C11` |
| `--text` | `#EDEEF2` |
| `--text-muted` | `#9BA1B4` |
| `--dot` | `#2C3040` |
| `--accent` | `#FF6A24` |
| `--accent-soft` | `#40230F` |
| `--yellow` | `#F0A81E` |
| `--yellow-dk` | `#A8730B` |
| `--teal` | `#3FBBD6` |
| `--teal-dk` | `#1E7186` |
| `--blue` | `#6D8BFF` |
| `--purple` | `#C95FE0` |

In dark, separation comes from **surfaces being lighter than the ground** while borders stay
near-black. Do not invert the light theme — it was tuned, not flipped.

### Colour rules

- **Spend boldness once.** `--accent` is the loud one. Yellow, teal and purple are identity
  colours for specific objects, not general-purpose decoration.
- Every app has one tint, used for its icon, its window title bar and its dock swatch.
  Readme teal, Scripts yellow, Camera orange, Editor purple.
- Title bars take a **26% mix** of the tint into `--surface-2`, never the raw tint — flooding
  the bar kills contrast on the muted meta text.
- `--blue` is reserved for links and focus outlines. Do not use it as a fill.

## Typography

| Role | Family | Used for |
|---|---|---|
| Display | **Bricolage Grotesque** 600/700/800 | Window titles, headings, icon labels, brand |
| Body | **IBM Plex Sans** 400/500/600 | All running text, buttons, form labels |
| Mono | **IBM Plex Mono** 400/500 | Clock, timecodes, code editor, metadata, eyebrows |

Loaded from Google Fonts with real fallback stacks. Headings get `text-wrap: balance` and
negative letter-spacing (`-0.01em` to `-0.025em`). Uppercase mono labels get `+0.07em`.

Base body is 15px / 1.55. Prose is capped at 64ch.

## Form language

| Property | Value |
|---|---|
| Border width | `--bw: 2px`, solid `--line` |
| Radius | `--radius: 10px` windows and panels, `--radius-s: 6px` buttons and chips |
| Shadow | Hard, zero blur, offset only |

Shadow offset encodes elevation:

- `2px` — chips and small buttons
- `3px` — file icons, toasts
- `4px` — dock, unfocused windows
- `5px` — desktop icons, export card
- `6px` — focused windows, launcher panel

Interactive things move. Buttons `translate(2px, 2px)` on `:active` and drop their shadow to
zero, so the press is physical. Icons lift `translateY(-6px)` on hover and their shadow grows.

## Motion

| Token | Curve | Used for |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Window open/close, most transitions |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.5, 1)` | Hover lifts, dock entry, shutter |

**The signature moment is the window open.** It is a FLIP: the window is measured where it
lands, transformed back to the icon's exact rectangle, then released over 430ms. Closing
reverses it into the icon. Folder lids hinge back on `rotateX`; app tiles press in.

Everything else stays quiet. One orchestrated moment beats scattered effects — resist adding
more animation.

`prefers-reduced-motion` kills all of it, plus the wallpaper parallax. Always honour it.

## Component patterns

- **Windows** — title bar with three chunky square buttons (close orange, minimise yellow,
  maximise teal), display-font title, mono meta on the right. Body scrolls, corner resizes.
- **Desktop icons** — folders draw a back panel, a tab and a hinged lid; apps draw a 92×100
  rounded tile with a white stroke glyph. Both boxes are 100px tall so the labels align.
- **Chips and buttons** — bordered, hard-shadowed, `--accent-soft` on hover.
- **Toasts** — pill, centred above the dock, auto-dismiss at 2.6s.
- **Empty states** — always say what to do next, never just "no items".

## Rules

- Tokens in the bare `:root` first. A colour defined only inside a media or `[data-theme]`
  block will not apply in the un-stamped default state.
- `body` sets an explicit `background` from a token.
- Every interactive element is a real `<button>` with a visible focus ring.
- No CSS framework, no component library, no bundler. Three globals per file, loaded in order.
- Wide content scrolls in its own `overflow-x: auto` container. The page body never scrolls
  sideways.
