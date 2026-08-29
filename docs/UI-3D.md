# The 3D canvas — visual and physics spec

Every effect here earns its place by *encoding state*. If an animation doesn't tell the analyst
something true about the graph, cut it — decoration is how a demo starts looking generated.

## Layout

```
┌──────────────────────────────────┬──────────────────┐
│                                  │  Inspector       │
│                                  │  selected entity │
│         3D CANVAS                ├──────────────────┤
│         spatial layer            │  Proposal tray   │
│                                  │  accept / reject │
│                                  ├──────────────────┤
│                                  │  Evidence drawer │
│                                  │  filing + span   │
├──────────────────────────────────┴──────────────────┤
│  Tool log — live WebMCP calls, args, duration       │
└─────────────────────────────────────────────────────┘
```

**The 3D layer is spatial. The 2D panels are evidential.** This split is what pays back the
readability cost of 3D: nothing you have to *read carefully* is ever rendered in perspective.

The tool log is not a debug panel. It is the visible proof that WebMCP is doing the work, and it is
the single cheapest thing you can build that raises the Leverage score. Style it properly.

## Node language

| Type | Geometry | Base colour | Why |
|---|---|---|---|
| Company | rounded box | cool slate | Institutional, rectilinear |
| Person | sphere | warm amber | The only organic form on the canvas |
| Address | flat octahedron | muted green-grey | Reads as a place, sits lower |
| Document | thin card sprite | near-white | A page, always facing camera |

Size by degree centrality, clamped — the hub genuinely looks like a hub, but nothing dwarfs the rest.

### State, expressed in material

| State | Material |
|---|---|
| Confirmed | solid `MeshStandardMaterial`, low emissive, full opacity |
| **Proposed** | wireframe overlay + high emissive, opacity ~0.6, emissive intensity pulsing on a sine wave (~0.8 Hz) |
| Selected | scale 1.15 + a camera-facing ring sprite |
| Dimmed | opacity 0.15, emissive 0 — used by "dim the rest" during path highlight |

A proposal should look *unsettled*. That is the whole idea: it is glowing, semi-transparent, and it
is physically floating further out than everything else.

## Link language

| State | Treatment |
|---|---|
| Confirmed | solid line, width by evidence count |
| **Proposed** | dashed line with animated dash offset — the moving dash reads as "live, being asserted" |
| Evidence-backed | `linkDirectionalParticles` flowing from source document toward the claim |
| Dimmed | opacity 0.08 |

`react-force-graph-3d` gives you `linkDirectionalParticles` and `linkDirectionalParticleSpeed`
directly. Use them for corroborated edges only, so particles mean something.

## Physics — where the metaphor lives

`d3-force-3d`, configured through the graph component's `d3Force` accessor.

| Force | Setting | Meaning |
|---|---|---|
| `charge` | ~-120, distanceMax ~400 | Nodes hold each other at arm's length; clusters stay legible |
| `link` distance | 40 base, 90 for proposals | **Proposals sit visibly further out** |
| `link` strength | 1.0 confirmed, **0.15 proposed** | The weak spring. A proposal drifts; a fact is held |
| `center` | mild | Keeps the working set on screen without crushing it |

### The three animated moments

**1. Proposal arrives.** Node is inserted at the midpoint of its evidence source and its target, with
a small outward velocity. Weak spring, so it settles far out and slightly restless. Camera does not
move unless the agent calls `focus`.

**2. Accept — the money shot.** Animate the link strength from 0.15 to 1.0 over ~700ms with an
ease-out cubic, and the distance from 90 to 40. Reheat the simulation
(`d3ReheatSimulation()`). The whole graph contracts and re-settles around the new fact. Drop the
emissive pulse to steady, remove the wireframe, take opacity to 1.

You are showing knowledge locking in. Do not shorten this animation to feel snappy — it is the
thing people will remember.

**3. Reject.** Apply a radial impulse away from the cluster, fade opacity to 0 over ~400ms, remove
the node. It should feel expelled, not deleted.

## Camera

- `focus(node_ids)` → compute the bounding centroid, `cameraPosition()` with a ~900ms transition,
  ease-in-out.
- Idle auto-rotate at ~0.3 deg/s, stopping the moment the user touches the canvas and resuming after
  ~20s of inactivity. Ambient motion makes a static screenshot look alive; anything faster makes it
  hard to work in.
- `F` focuses the selection, `Esc` clears it, double-click a node flies to it.

## Bloom (P1, do it if Tuesday goes well)

`UnrealBloomPass` on the composer exposed by `postProcessingComposer()`. Threshold high enough that
only the emissive proposal nodes bloom — if everything glows, nothing means anything. Strength
~1.2, radius ~0.5. This is the single highest wow-per-line-of-code change available.

## Readability mitigations — do not skip these

3D costs you legibility and you pay it back deliberately:

- **Depth fog** matched to the background so distant nodes recede rather than clutter.
- **Labels as camera-facing sprites**, shown only for selected, hovered, proposed, or high-degree
  nodes. Labelling everything is what makes 3D graphs unusable.
- **Dim the rest** when a path is highlighted — the path stays at full opacity, everything else
  drops to 0.15. This is how a four-hop chain becomes readable in perspective.
- **Hover raycast tolerance** slightly generous; small nodes in 3D are hard to hit.
- **Never require reading in 3D.** Names, dates and filing text belong in the panels.

## Palette

One accent, spent on proposals. Everything else quiet.

```css
:root {
  --bg:        #0B0E12;   /* deep, so emissive reads */
  --grid:      #161B22;
  --company:   #7C8CA1;
  --person:    #D9A05B;
  --address:   #6E8577;
  --document:  #E6E8EA;
  --proposed:  #4FD1C5;   /* the only saturated colour on screen */
  --confirmed: #E6E8EA;
  --reject:    #C2513F;
}
```

Dark-committed by design — an investigation canvas is a dark room, and emissive materials need a
dark ground to read. The 2D panels use the same tokens so the two layers feel like one product.

## Performance

The canvas holds the working set — twelve nodes at boot, roughly forty by the end of a session — not
the corpus. WebGL will not break a sweat, which frees you to spend the budget on materials and
bloom rather than on culling.

## Reduced motion

Honour `prefers-reduced-motion`: no auto-rotate, no emissive pulse, camera transitions become
instant cuts, accept still re-settles but over 200ms. The state must remain readable from material
and opacity alone — which it does, because none of the state above is encoded *only* in motion.
