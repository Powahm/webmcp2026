---
name: Loud looks: glass and maximalist
description: Use only when the creator asks for a look, in those words: glassmorphic, frosted, maximalist, chaotic, neon, vaporwave, y2k, brutalist, over the top, or "make it wildly different". It deliberately breaks the restraint the other motion skill asks for, and gives exact recipes for two loud registers that still hold together.
triggers: glass, frosted, maximalist, maximalism, chaotic, neon, vaporwave, y2k, brutalist, over the top, wildly, sticker, holograph, iridescent, acid, retro
---

# Loud looks: glass and maximalist

**Read this only if they asked for it.** The other motion skill is the house
voice: one idea on screen, colour spent once, type big or small and nothing
between. It is right for almost every request and you should keep following it
by default.

This file is for when someone says *"make it glassmorphic"* or *"go
maximalist"* or *"make it wildly different"*. Then restraint is the wrong
answer, and the two registers below are how to be loud on purpose instead of
loud by accident.

Say which register you picked and why, in one line, before you start staging.

---

## What you actually have

You are filling in specs, not writing CSS. There is no blur, no
`backdrop-filter`, no gradient and no blend mode. So a look here is built from
five levers, and both registers below are the same five levers pushed in
opposite directions:

| Lever | Field | Range |
|---|---|---|
| Translucency | `opacity` | 0 to 1 |
| Real colour | `fill`, `stroke`, `palette_role` | any hex, e.g. `"#7DF9FF"` |
| Geometry | `shape` | rect, ellipse, pill, triangle, line, arrow, ring, star |
| Grain and scanlines | `effect` + `strength` | 8 effects, 0 to 1 |
| Entrance | `animation` | fade, rise, drop, slide_left, slide_right, pop, grow, none |

**Two rules that decide whether either register works.**

1. **Layers draw in the order you propose them.** The first call is underneath.
   So a panel goes in *before* the words that sit on it. Get this backwards and
   the plate covers the type.
2. **A hex is exact, a role follows the theme.** These looks depend on precise
   colour, so use hex for the look and keep roles for anything that must stay
   legible if the theme flips.

---

## Register A: Glass

Frosted panels, hairline edges, cool light, type that floats. Quiet-loud: it
reads expensive rather than busy. Use it for product shots, UI walkthroughs,
anything over footage that is already dark.

**There is no blur, so glass is faked with three things, and all three are
required.** A low-opacity fill, a brighter hairline stroke, and grain. Drop any
one of them and it stops reading as glass and starts reading as a transparent
rectangle.

### The panel, every time

```
propose_layer
  component: "shape"
  shape: "rect"
  point: { x: 0.5, y: 0.5 }
  width: 0.62
  height: 0.26
  radius: 340
  fill: "#FFFFFF"
  opacity: 0.16          <- the pane
  stroke: "#FFFFFF"
  stroke_width: 2        <- the lit edge. This is the whole tell.
  animation: "grow"
```

Then the words **in a second call**, on top:

```
propose_layer
  component: "text"
  text: "Frosted, not flat"
  font: "displayHeavy"
  size: 82
  align: "center"
  point: { x: 0.5, y: 0.5 }
  backdrop: "none"       <- the panel IS the plate
  palette_role: "#FFFFFF"
  animation: "fade"
```

Then the frost, **once per sequence, not once per panel**:

```
propose_layer  component: "effect"  effect: "grain"  strength: 0.16
```

### Glass rules

- **`opacity` 0.12 to 0.22.** Below 0.10 there is no pane. Above 0.30 it is a
  grey box.
- **The stroke is always lighter than the fill and always 2 to 3.** A hairline
  is what the eye reads as an edge catching light.
- **`radius` 260 to 400** on a rect. Glass is soft-cornered. A sharp corner
  reads as brutalism, which is the other register.
- **Cool hexes only:** `#FFFFFF`, `#CFE9FF`, `#7DF9FF`, `#B8B5FF`, `#8AF5D0`.
  One of them per sequence, and white for the type.
- **Stack at most two panes**, offset, the back one at half the front one's
  opacity. Three is a pile.
- **Never over a light or busy ground.** Glass needs something dark behind it.
  If the footage is bright, put `effect: "wash"` at `strength: 0.5` down first.
- **`animation: "grow"` or `"fade"`.** Never `pop`. Glass does not bounce.

---

## Register B: Maximalist

Saturated, overlapping, tilted, too much on purpose. Stickers, acid colour,
things rotated off-axis, scanlines over everything. Use it for a hook, a
title card with attitude, anything meant to feel like a zine or a Y2K poster.

**This register deliberately breaks the one-idea rule.** Five to nine elements
on screen at once is the point. What keeps it from being a mess is that the
*chaos is structured*: one palette, one focal word, everything else decoration
rotated off-square.

### The recipe

1. **Ground.** `propose_blank_clip`, colour `#12021F` or `#FF2D95`.
2. **Three to five shapes first**, scattered with `point`, each `rotation`
   between -24 and 24, each a different `shape` from: `star`, `ring`,
   `triangle`, `pill`, `arrow`. Sizes `width` 0.10 to 0.28. Full `opacity`.
   Colours from one acid set:
   `#FF2D95`, `#FFE800`, `#00F5D4`, `#7B2FFF`, `#FF6A00`.
3. **One huge word** in the middle, `size` 150 to 200, `font: "displayHeavy"`,
   `outline: 6`, `palette_role: "#FFE800"`, `animation: "pop"`.
4. **A tilted label**, `size` 24, `tracking` 0.28, UPPERCASE, `rotation: -8`,
   parked in a corner with `point`.
5. **Two stacked effects**: `scanlines` at `strength: 0.30`, then `grain` at
   `0.28`. Both across the whole clip.

### Maximalist rules

- **One palette, no exceptions.** Five hexes, chosen up front, named in your
  reply. The instant a sixth colour appears it stops being a style and becomes
  a mistake.
- **Nothing is square.** Every shape gets a non-zero `rotation`. A maximalist
  layout with everything at 0° looks like a broken grid.
- **One focal word, and it is the biggest thing by a factor of four.** The
  decoration is decoration. If two things compete, delete one.
- **`animation: "pop"` and `"grow"`, staggered.** Give each shape an
  `at_seconds` 0.1 to 0.2 apart so they arrive as a burst rather than a
  slideshow.
- **Outline the type, do not plate it.** `outline: 5` to `8` survives any
  background. `backdrop: "box"` over this much colour is a coffin.
- **Effects go last** so they sit over everything.

---

## Both registers

- **Check `get_composition` first** for the format. In `vertical` halve every
  `width` and move `point.x` to 0.5: a layout that works at 16:9 is a column
  at 9:16.
- **Sound, or it is a poster.** `propose_sound` a `whoosh` under a glass panel
  and a `hit` under a maximalist title, at the same `at_seconds` as the layer.
- **Hold longer than feels right.** 3.5 to 5 seconds. Both looks need reading
  time, and a maximalist frame needs more, not less.
- **Stop and say what you did.** List the hexes and the register. If they
  wanted the other one, that is one sentence to fix rather than nine layers to
  undo.
- **You cannot accept any of this.** Every layer lands dashed and waits for
  them. Do not stage a second variation until they have judged the first.
