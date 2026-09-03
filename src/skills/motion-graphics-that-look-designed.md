---
name: Motion graphics that look designed
description: Use whenever you are asked for a title, an animation, an infographic, kinetic text, a stat, a list or any graphic over a cut. It says what professional motion design looks like here, and gives exact recipes to copy so the result reads like a keynote or a top creator's edit, never like a template.
triggers: timeline_has_clips, graphic, graphics, animation, animate, motion, title, infographic, kinetic, keynote, stat, list, overlay, intro, hook, caption, slop
---

# Motion graphics that look designed

You are not drawing. You fill in specs and the editor draws them. So the look
is decided by four things you control: **how few elements**, **how big the
type is**, **how the beats are timed**, and **whether sound lands with them**.
Templates get all four wrong in the same way: too many elements, medium-sized
type, everything at once, silence. Do the opposite and it stops looking generic.

Two registers cover almost every request. Pick one per clip, never both.

| Register | Looks like | Use for |
|---|---|---|
| **Kinetic** | A creator's YouTube edit. Dark ground, huge bold words one at a time in the middle of the frame, one word in accent, numbers that count up, cuts to black, a little grain. Fast. | Hooks, punchlines, stats, anything said with energy |
| **Keynote** | An Apple product launch. Black or near-white ground, one short line centred with air around it, small tracked label above, slow fade or rise, long dwell. Quiet. | Openings, chapter breaks, a claim you want taken seriously, product names |

## The ten rules

1. **One idea on screen at a time.** If a second element is up, the first must
   have ended. `center` holds one thing. The eye cannot read two.
2. **Type is big or it is a caption.** Headlines: `size` 96 to 160. Kinetic
   words: 120 to 180. Labels: 22 to 28 with `tracking` 0.12 and UPPERCASE.
   Nothing lives between 40 and 90 unless it is a subtext line.
3. **Fonts: `displayHeavy` for anything big, `body` for anything small,
   `mono` only for code or a timestamp.** Never `display` for a label.
   Tight headlines want `tracking` -0.02.
4. **Ground first.** A sequence gets its own `propose_blank_clip`, colour
   `#0B0B0F` (kinetic) or `#000000` / `#F5F5F0` (keynote). Text over footage
   gets `backdrop: "scrim"`, never `"box"`, never nothing. A box is the
   template tell.
5. **Colour is spent, not sprinkled.** Words are white, `"#FFFFFF"`, on a dark
   ground or over a scrim, and `"#111111"` on a light ground. Do not use
   `plain` for words on a blank clip: it is the theme's text colour, which is
   dark in the light theme and vanishes on black. One word or one number per
   clip gets `accent`, and that is the only other colour in the clip. Never
   any other hex unless the person named it.
6. **Stagger, never stack.** No two elements start on the same second. Kinetic
   words: a new word every 0.35 to 0.6 s. Keynote lines: 0.8 s apart at least.
7. **Dwell.** Kinetic: 0.5 to 1.2 s per word or phrase. Keynote: 2.5 to 5 s per
   line. A word that disappears before it can be read was not worth showing.
8. **Motion has a direction, and it is subtle.** Kinetic uses `pop` with
   `easing: "spring_out"`. Keynote uses `fade` or `rise` with `easing: "out"`.
   Never `slide_left` or `slide_right` for words. Never `drop`. Never `grow`
   on text.
9. **Every element gets a sound, at the same `at_seconds`.** No exceptions.
   Silent graphics look like stills.
10. **Fewer than you think.** A three-beat sequence that lands beats a
    nine-beat one that blurs. If you cannot say why an element is there in
    the `reason`, do not propose it.

## Recipes (copy the numbers)

Every recipe is a list of calls, in order. Read `get_composition` first, and
`get_transcript` when the graphic sits on something said, so `at_seconds`
comes from the words.

### Kinetic hook (4 to 6 words, ~3 s)

Make a blank clip, then one `text` layer per word or two-word phrase.

```
propose_blank_clip  seconds: 3.2, colour: "#0B0B0F"
propose_layer  component: "effect", effect: "grain", strength: 0.18, at_seconds: T, duration_seconds: 3.2
propose_layer  component: "text", text: "NOBODY", font: "displayHeavy", size: 150, tracking: -0.02,
               position: "center", palette_role: "#FFFFFF", animation: "pop", easing: "spring_out",
               at_seconds: T+0.0, duration_seconds: 0.55
propose_sound  kind: "sfx", preset: "pop", at_seconds: T+0.0, gain: 0.5
propose_layer  ... text: "TELLS YOU", at_seconds: T+0.5, duration_seconds: 0.6   + pop
propose_layer  ... text: "THIS", at_seconds: T+1.05, duration_seconds: 0.55        + pop
propose_layer  ... text: "PART", palette_role: "accent", size: 170, at_seconds: T+1.55, duration_seconds: 1.4
propose_sound  kind: "sfx", preset: "hit", at_seconds: T+1.55, gain: 0.6
```

Only the last word is `accent`, and it is the biggest and dwells longest.
Uppercase every word in this register. Each word ends before the next starts.

### Kinetic caption on speech (the words they actually say)

Use `caption_pop` with `timings` so each word lands on the frame it is spoken.
`get_transcript` with `include_words: true` gives each word's start in seconds;
`timings` wants one frame number per word, counted from the layer's own start:
`round((word_start - at_seconds) * fps)`, with `fps` from `get_composition`
(30). One line of at most eight words.
`position: "center"` for a punchline, `bottom_bar` for a running caption.
`font: "displayHeavy"`. One `pop` sound at the start only, not one per word.

### Big number (a stat said out loud)

```
propose_layer  component: "stat_badge", text: "40%", subtext: "less time in the edit",
               position: "center", palette_role: "accent", easing: "out",
               at_seconds: T, duration_seconds: 3
propose_sound  kind: "sfx", preset: "tick", at_seconds: T, gain: 0.45
propose_sound  kind: "sfx", preset: "chime", at_seconds: T+1.2, gain: 0.5
```

The figure carries its unit inside `text`. The subtext says what the number
is of, in five words or fewer. Never two stats on screen together; if there
are three numbers, they are three beats 2.5 s apart with a `dip` between.

### Keynote title

```
propose_blank_clip  seconds: 5, colour: "#000000"
propose_layer  component: "text", text: "CHAPTER 02", font: "body", size: 24, tracking: 0.14,
               point: {x: 0.5, y: 0.42}, align: "center", palette_role: "accent",
               animation: "fade", easing: "out", at_seconds: T+0.2, duration_seconds: 4.6
propose_layer  component: "text", text: "Cut by talking.", font: "displayHeavy", size: 128, tracking: -0.02,
               point: {x: 0.5, y: 0.52}, align: "center", palette_role: "#FFFFFF", animation: "rise", easing: "out",
               at_seconds: T+0.7, duration_seconds: 4.1
propose_sound  kind: "sfx", preset: "hit", at_seconds: T+0.7, gain: 0.45
propose_layer  component: "effect", effect: "vignette", strength: 0.35, at_seconds: T, duration_seconds: 5
```

Sentence case. A full stop at the end of the line is part of the look. The
label sits above the line, small, tracked, in the one accent. Nothing else.

### Keynote list (three things)

Not a `bullet_list`. Three `text` lines, `size` 72, `font: "displayHeavy"`,
`align: "left"` at `point` x 0.12, y 0.38 / 0.50 / 0.62 (send `point`, not `position`), each arriving 0.9 s
after the last with `rise`, each dwelling until the clip ends. A `tick` under
each. The line being spoken can be `accent`; the others stay `"#FFFFFF"`. Use
`bullet_list` only when the person asks for a list panel.

### Transition between beats

`effect: "dip"`, `strength: 1`, `palette_role: "#000000"` (or `"#FFFFFF"` for a flash to white), `duration_seconds: 0.4`,
placed so it straddles the cut. One `whoosh` at 0.35 gain. Use it between
sections, not between every word.

## What a template looks like (do none of this)

- `title_card` with a headline **and** subtext **and** eyebrow all filled in.
- A `bullet_list` with six rows that arrive in one second.
- `comparison_cards` with three cards that all say a variant of the same thing.
- `size` 48 to 64 text at `lower_left` with a `box` backdrop.
- `accent` on the title, the list, and the stat. Three accents means none.
- Anything `slide_left`. Anything that `grow`s.
- A stat that says "10x" or "many". A word like Seamless, Elevate, Unlock,
  Empower, Game-changer, Next-level. Write the specific thing instead.
- Two graphics at once because "it felt empty". Empty is the look.

## Pre-flight, before each `propose_layer`

Is there already something at this position at this second? Is the type at
least 96, or is it a label at 22 to 28 with tracking? Is exactly one thing in
`accent` in this clip, and is everything else `"#FFFFFF"` rather than `plain`? Is a sound proposed at the same `at_seconds`? Does the
`reason` name the moment in their words ("the 40% you say at 0:14")? If any
answer is no, fix it before you send.
