# UI, visual and physics spec

Every effect here earns its place by *encoding state*. If an animation doesn't tell the analyst
something true about the graph, cut it. Decoration is how a demo starts looking generated.

## Layout

Two workspaces, one shared rail, `W` toggles between them. Both stay mounted, switching loses no
state. **The app opens on READ**, because the human reads first.

```
READ  (the human's work)                CANVAS  (the shared picture)
┌────────┬─────────────┬──────┬──────┐  ┌────────┬────────────────┬──────┐
│ FILINGS│  THE FILING │ marks│ ▸tabs│  │ CORPUS │                │ ▸tabs│
│  queue │             │      │      │  │ search │   LINK CANVAS  │      │
│        │  select →   │ yours│ Prop-│  │        │   pan · zoom   │ Prop-│
│        │  mark typed │  ─── │ osals│  │        │   drag · click │ osals│
│        │             │ agent│ Enq. │  │        │                │ Enq. │
│        │             │      │ Evid.│  │        │                │ Evid.│
│        │             │      │ Deta.│  │        │                │ Deta.│
│        ├─────────────┴──────┤ Deci.│  │        │                │ Deci.│
│        │ mark bar  1..6     │      │  │        │                │      │
├────────┴────────────────────┴──────┤  ├────────┴────────────────┴──────┤
│  Tool log, live WebMCP calls      │  │  Tool log                      │
└────────────────────────────────────┘  └────────────────────────────────┘
```

The right rail is tabbed rather than stacked. Five panels compete for one column and stacking them turns
the rail into a scroll; tabs keep each one whole, and the badge on Proposals and Enquiries is what
tells the analyst something arrived.

**The canvas is spatial. The reader and the panels are evidential.** Nothing you have to *read
carefully* is ever rendered on a moving surface, and with the Reader the split is now literal: an
entire workspace where nothing moves.

The tool log is not a debug panel. It is the visible proof that WebMCP is doing the work, and it is
the single cheapest thing you can build that raises the Leverage score. Style it properly.

## Why the canvas is 2D

It was 3D, force-directed in three dimensions, on `react-force-graph-3d`. That is gone, and the
reasoning is worth keeping written down so nobody re-adds it.

- **3D genuinely costs legibility.** Occlusion and depth ambiguity make a network harder to read and
  harder to click, and every mitigation for that (fog, camera-facing labels, dim-the-rest) is
  effort spent buying back something 2D never took away.
- **The camera had a failure mode with no 2D equivalent.** Framing was computed along the vector
  from the world origin to the target. That vector collapses when the target is near the origin,
  which is exactly where a freshly proposed node sits before the simulation places it: the camera
  ended up at the origin looking at the origin and the screen went black. In 2D, framing is
  "centre the box, pick a scale". There is no direction to compute.
- **The library pulled its own copy of three.js.** A version skew put two three.js builds on the
  page and one called a method on a matrix from the other. Hard error on every load.
- **We lost nothing that carried meaning.** The physics metaphor. A proposal on a weak, long
  spring, contracting when accepted, works identically in two dimensions, and you can actually
  see it happen.

The canvas is now a single 2D context driven by a hand-rolled simulation in
`src/canvas/simulation.ts`. **No graph library, no WebGL, no dependencies at all**, so the
duplicate-package class of bug cannot recur. Naive O(n²) repulsion: forty nodes is 1,600 pairs a
frame, which is nothing, and a working set in the hundreds is a product problem before it is a
performance one.

## Node language

| Type | Colour | Why |
|---|---|---|
| Company | cool slate | Institutional |
| Person | warm amber | The only warm hue on the canvas |
| Address | muted green | Reads as a place |
| Document | soft violet | A page |

Every node is a disc with a soft radial glow bleeding into the background, the Obsidian read.
Radius by degree, clamped, so a hub genuinely looks like a hub and nothing dwarfs the rest.

### State

| State | Treatment |
|---|---|
| Confirmed | filled disc, full opacity |
| **Proposed** | **hollow**, background fill, dashed teal ring, glow breathing on a slow sine |
| Selected | a ring *outside* the disc, so selecting never changes a node's size |
| Dimmed | opacity 0.22, everything that is not the hovered node or its neighbours |

A proposal is a shape waiting to be filled in. It is hollow, it is dashed, and it is the only thing
on the canvas that moves when nothing is happening.

## Link language

| State | Treatment |
|---|---|
| Confirmed | solid, 1.4px |
| Corroborated (more than one citation) | solid, 2.1px, lighter |
| **Proposed** | dashed teal, dash offset advancing, "live, being asserted" |
| Analyst-asserted, no filing found | a warm line. An uncited edge must never look like a cited one |

## Labels

Labels are where a link chart looks broken, so they get more care than anything else on the canvas.

- **Two passes.** Every disc is drawn and its box recorded, *then* labels are placed. A one-pass
  renderer can only test a label against labels drawn before it, which is how you end up with text
  across a node.
- **Collision means drop, not shrink.** A label that would overlap anything already placed is
  skipped. Nothing is lost, the node is still there and hovering brings its name straight back.
- **Priority order:** hovered, then selected, then proposals, then hubs. The node the analyst is
  pointing at always keeps its name.
- **Addresses are shortened** to building plus postcode. A full registered office string is longer
  than the rest of the chart put together; the Inspector shows the whole thing.
- **A halo, not a box.** Stroked background text rather than a filled rectangle, boxes turn the
  canvas into a wall of rectangles as the working set grows.

## Physics, where the metaphor lives

`src/canvas/simulation.ts`. Every number is a claim about how much the analyst believes something.

| Force | Setting | Meaning |
|---|---|---|
| charge | -1500, cut off at 620 | Nodes hold each other at arm's length; clusters stay legible |
| collision | radius + 16 | Discs never overlap, so labels have somewhere to go |
| link distance | 150 confirmed, **280 proposed** | **Proposals sit visibly further out** |
| link strength | 0.55 confirmed, **0.06 proposed** | The weak spring. A proposal drifts; a fact is held |
| centre | mild | Keeps the working set on screen without crushing it |

### The animated moments

**1. A proposal arrives.** Seeded beside a neighbour that already has a position, never at the
origin, which flings it across the screen on its first frames. Weak spring, so it settles far out
and stays slightly restless. The view does not move unless the agent calls `focus`.

**2. Accept, the money shot.** Link strength animates 0.06 → 0.55 and distance 280 → 150 over
~700ms on an ease-out cubic, with the simulation reheated. The graph contracts and re-settles
around the new fact. Do not shorten it to feel snappy; it is the thing people remember.

**3. The agent's mark appears.** A 200ms fade in the reader and nothing else. No pulse, no motion.
It lands in text the analyst is reading, and animation in text someone is reading is hostile. It
earns its effect by being the quietest thing in the app.

## The view

- **It frames itself until you touch it.** The transform eases towards a fit of the whole graph
  every frame until the analyst pans, zooms, or is flown somewhere. Then the app stops touching
  the view entirely. Booting off-centre and small is the difference between "here is your case" and
  "your first action is a pan"; a view that keeps correcting you afterwards is worse than either.
- `focus(node_ids)` eases to a fit of those nodes over ~620ms. A single node, or several stacked
  before the simulation separates them, is a zero-extent box. `viewport.frame()` floors the extent
  before dividing, so it yields a valid transform instead of the black screen the 3D camera gave.
- `F` frames the selection, or everything if nothing is selected. `Esc` clears. Drag a node to move
  it; releasing hands it back to the simulation rather than pinning it, so the analyst can never
  build a layout the physics then contradicts.
- Hovering a node dims everything that is not it or its neighbours. That is how a dense chart stays
  readable without a mode to switch into.

## The reader

The other half of the product, and the half the analyst spends most of their time in. Its visual
rules are in `docs/METHOD.md` and the one that matters is here too:

**The human's marks colour the page. The agent's only underline it.** A wash of the type colour for
a mark the analyst made; a teal underline for one the agent made; both when they overlap. That
survives greyscale and colour-blindness, which a two-hue scheme would not, and it keeps the
analyst's own reading visually primary. Teal is the agent's colour and appears nowhere else in the
application.

The filing itself is `white-space: pre-wrap` and nothing else. No wrapping, trimming, smart quotes
or whitespace collapsing, every span in the corpus and every mark the analyst makes is an index
into that exact string.

## Palette

One accent, spent entirely on the agent. Tokens live in `src/styles/tokens.css`, and
`src/canvas/palette.ts` mirrors them by hand because a 2D context cannot read custom properties.
If you change one, change both.

## Performance

Forty nodes, a rAF loop that owns the simulation step, the fly-to interpolation and the draw. No
`setInterval` drives an animation, so nothing can keep running after unmount. Nodes outside the
viewport are culled before drawing. The simulation stops when alpha reaches its floor.

## Reduced motion

`prefers-reduced-motion` collapses the accept animation to 200ms, stops the proposal breathing and
the dash offset, and makes the fly-to instant. Nothing is removed, every state stays legible
without motion, which is the test.
