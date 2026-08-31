import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findPaths } from "../corpus/paths";
import { canvasEdges, clearSelection, setViewport, toggleSelection } from "../state/actions";
import { useGraphStore } from "../state/graphStore";
import { pendingProposals, useProposalStore } from "../state/proposalStore";
import { NODE_KINDS, useGlyphStore } from "./glyphs";
import type { NodeKind } from "./palette";
import { draw, hitTest, linkKey, resizeCanvas, type DrawLink, type DrawNode, type Scene } from "./render";
import {
  linkDistanceFor,
  linkStrengthFor,
  Simulation,
  type SimLink,
} from "./simulation";
import {
  easeInOutCubic,
  frame,
  identity,
  lerpTransform,
  prefersReducedMotion,
  toWorld,
  zoomAbout,
  type Transform,
} from "./viewport";

/**
 * The canvas.
 *
 * A flat 2D link chart — pan, zoom, drag, click — of the kind people already
 * know how to use. It was 3D and force-directed in three dimensions; that cost
 * more than it earned. Occlusion and depth ambiguity make a network genuinely
 * harder to read, the camera had a failure mode that put the analyst inside the
 * world, and the graph library pulled its own copy of three.js. None of that
 * bought anything the product needed.
 *
 * What survives is the part that carried meaning: a proposal hangs on a weak,
 * long spring and visibly floats unsettled at the edge of the cluster, and
 * accepting it tightens the spring so the graph contracts around the new fact.
 *
 * Rendering is a single 2D canvas driven by src/canvas/simulation.ts. No graph
 * library, no WebGL, no dependencies.
 */

const ACCEPT_MS = 700;
const ACCEPT_MS_REDUCED = 200;
const FLY_MS = 620;

const acceptProgress = (justAccepted: number | undefined, now: number, reduced: boolean): number => {
  if (!justAccepted) return 1;
  const t = Math.min(1, (now - justAccepted) / (reduced ? ACCEPT_MS_REDUCED : ACCEPT_MS));
  return 1 - Math.pow(1 - t, 3);
};

/**
 * A sim link plus the two facts the render loop needs to animate it: whether
 * it is a proposal (constant physics) or confirmed (may be mid-accept), and
 * when it was accepted, if recently. `distance`/`strength` on these objects
 * are placeholders filled in at scene-build time; the render loop overwrites
 * them every frame from the real clock, in place, on the same objects that
 * `sim.links` holds — see the render loop below for why that has to happen
 * there and not here.
 */
type AnimLink = SimLink & { proposed: boolean; justAccepted?: number };

export default function GraphCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef(new Simulation());
  const transformRef = useRef<Transform>(identity());
  const sizeRef = useRef({ w: 0, h: 0 });

  /**
   * True once the analyst has panned, zoomed or been flown somewhere.
   *
   * Until then the view keeps refitting to the whole graph every frame, so the
   * chart is always framed no matter how the simulation moves — booting
   * off-centre and small is the difference between "here is your case" and
   * "your first action is a pan". After the analyst touches the canvas we stop
   * touching it: nothing is more irritating than a view that keeps correcting
   * you.
   */
  const userMovedView = useRef(false);

  /** An in-flight fly-to. Interpolated in the render loop rather than by a
   *  timer, so it cannot outlive the component or fight a user pan. */
  const flightRef = useRef<{ from: Transform; to: Transform; start: number } | null>(null);

  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [cursor, setCursor] = useState<"grab" | "grabbing" | "pointer">("grab");

  /** Only the legend needs these in React. The canvas reads them straight from
   *  the store on each frame, so a change shows up without an invalidation. */
  const glyphs = useGlyphStore((s) => s.glyphs);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selection = useGraphStore((s) => s.selection);
  const focusRequest = useGraphStore((s) => s.focusRequest);
  const reheat = useGraphStore((s) => s.reheat);
  const proposalMap = useProposalStore((s) => s.proposals);

  const pending = useMemo(() => pendingProposals(proposalMap), [proposalMap]);

  // --- Verification hook, inert unless asked for ----------------------------
  // Exposes the live Simulation on window so a test harness can read link
  // distance/strength directly instead of screenshotting and guessing. Only
  // runs when the page is loaded with ?debugSim in the URL — never in a
  // normal session, and never something a build flag has to strip.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("debugSim")) {
      (window as unknown as { __tw_sim?: Simulation }).__tw_sim = simRef.current;
    }
  }, []);

  // --- Scene data: confirmed graph plus pending proposals -------------------
  const scene = useMemo(() => {
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const e of edges.values()) {
      bump(e.from_id);
      bump(e.to_id);
    }

    const drawNodes = new Map<string, DrawNode>();
    for (const n of nodes.values()) {
      drawNodes.set(n.id, {
        id: n.id,
        type: n.type as NodeKind,
        label: n.label,
        proposed: false,
        weight: degree.get(n.id) ?? 0,
        citations: n.citations.length,
      });
    }

    const drawLinks: DrawLink[] = [];
    const simLinks: AnimLink[] = [];
    const now = Date.now();
    const reduced = prefersReducedMotion();

    for (const e of edges.values()) {
      const corroborated =
        e.citations.length + (e.citations[0]?.corroborating?.length ?? 0) > 1;
      drawLinks.push({
        source: e.from_id,
        target: e.to_id,
        proposed: false,
        asserted: e.analystAsserted === true,
        corroborated,
      });
      const t = acceptProgress(e.justAccepted, now, reduced);
      simLinks.push({
        source: e.from_id,
        target: e.to_id,
        proposed: false,
        justAccepted: e.justAccepted,
        distance: linkDistanceFor(false, t),
        strength: linkStrengthFor(false, t),
      });
    }

    for (const p of pending) {
      if (p.kind !== "node" || drawNodes.has(p.node_id)) continue;
      drawNodes.set(p.node_id, {
        id: p.node_id,
        type: p.entityType as NodeKind,
        label: p.label,
        proposed: true,
        weight: 0,
        citations: 1,
      });
    }
    for (const p of pending) {
      if (p.kind !== "edge") continue;
      if (!drawNodes.has(p.from_id) || !drawNodes.has(p.to_id)) continue;
      drawLinks.push({
        source: p.from_id,
        target: p.to_id,
        proposed: true,
        asserted: false,
        corroborated: false,
      });
      simLinks.push({
        source: p.from_id,
        target: p.to_id,
        proposed: true,
        justAccepted: undefined,
        distance: linkDistanceFor(true),
        strength: linkStrengthFor(true),
      });
    }

    return { drawNodes, drawLinks, simLinks };
  }, [nodes, edges, pending]);

  /**
   * The route between the two nodes the analyst selected, if one exists.
   *
   * Two selections is the gesture that means "how are these related?", so it
   * is the moment to answer. Before the agent has worked there is no path and
   * the canvas says so out loud — which is the honest half of the story, and
   * the half most demos skip.
   */
  const path = useMemo(() => {
    if (selection.length !== 2) return null;
    const [from, to] = selection;
    const found = findPaths(canvasEdges(), from, to, 4, 1)[0];
    if (!found) return { nodes: new Set<string>(), edges: new Set<string>(), hops: 0, found: false };
    return {
      nodes: new Set(found.node_ids),
      edges: new Set(found.edges.map((e) => linkKey(e.from_id, e.to_id))),
      hops: found.hops,
      found: true,
    };
    // The confirmed graph is the input, so recompute whenever it changes.
  }, [selection, nodes, edges]);

  /** Neighbours of the hovered node. Everything else dims, which is how a dense
   *  chart stays readable without a mode to switch into. */
  const adjacent = useMemo(() => {
    const set = new Set<string>();
    if (!hovered) return set;
    for (const l of scene.drawLinks) {
      if (l.source === hovered) set.add(l.target);
      if (l.target === hovered) set.add(l.source);
    }
    return set;
  }, [hovered, scene.drawLinks]);

  // --- Feed the simulation --------------------------------------------------
  useEffect(() => {
    const sim = simRef.current;
    sim.setGraph(
      [...scene.drawNodes.values()].map((n) => ({ id: n.id, weight: n.weight })),
      scene.simLinks
    );
    sim.reheat(0.7);
  }, [scene]);

  useEffect(() => {
    if (!reheat) return;
    simRef.current.reheat(0.9);
  }, [reheat]);

  // --- The render loop ------------------------------------------------------
  // One rAF loop owns everything: the simulation step, the fly-to
  // interpolation, and the draw. Nothing here is driven by setInterval, so
  // there is no way for an animation to keep running after unmount.
  useEffect(() => {
    let raf = 0;
    const reduced = prefersReducedMotion();

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;

      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      if (w !== sizeRef.current.w || h !== sizeRef.current.h) {
        sizeRef.current = { w, h };
        resizeCanvas(canvas, w, h);
      }

      const sim = simRef.current;

      // The accept animation lives here, not in the scene memo. Distance and
      // strength are a function of wall-clock time (see acceptProgress), so a
      // memo that only re-runs when the graph changes freezes them at
      // whatever they were the instant the memo ran — that was the bug: an
      // accepted edge sat at t=0 forever because nothing re-invoked it.
      // Mutating the same SimLink objects sim.links already holds, on every
      // frame, is what makes the spring actually tighten in front of tick().
      const now = Date.now();
      let animating = false;
      for (const l of sim.links as AnimLink[]) {
        const t = acceptProgress(l.justAccepted, now, reduced);
        l.distance = linkDistanceFor(l.proposed, t);
        l.strength = linkStrengthFor(l.proposed, t);
        if (t < 1) animating = true;
      }
      // Without this, alpha can decay to its floor mid-animation and the
      // contraction visibly stalls partway through instead of completing.
      if (animating) sim.reheat(0.35);

      sim.tick();

      // Keep the whole graph framed until the analyst takes the view over.
      // Easing towards the target rather than snapping means the settling
      // layout reads as one continuous movement instead of a series of jumps.
      if (!userMovedView.current && sim.nodes.length > 0) {
        const box = sim.bounds();
        if (box) {
          const target = frame(box, w, h, 120, 1.9);
          transformRef.current = sim.settled
            ? target
            : lerpTransform(transformRef.current, target, 0.08);
        }
      }

      const flight = flightRef.current;
      if (flight) {
        const t = Math.min(1, (Date.now() - flight.start) / (reduced ? 1 : FLY_MS));
        transformRef.current = lerpTransform(flight.from, flight.to, easeInOutCubic(t));
        if (t >= 1) flightRef.current = null;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const positions = new Map(sim.nodes.map((n) => [n.id, n]));
      const s: Scene = {
        nodes: scene.drawNodes,
        links: scene.drawLinks,
        positions,
        selection: new Set(selection),
        hovered,
        adjacent,
        path: path?.found ? { nodes: path.nodes, edges: path.edges } : null,
        time: performance.now(),
        reducedMotion: reduced,
      };
      draw(ctx, s, transformRef.current, w, h);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene, selection, hovered, adjacent, path]);

  // --- Report the viewport, so get_viewport can answer honestly -------------
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const t = transformRef.current;
      const visible: string[] = [];
      for (const n of simRef.current.nodes) {
        const sx = n.x * t.k + t.tx;
        const sy = n.y * t.k + t.ty;
        if (sx >= 0 && sy >= 0 && sx <= w && sy <= h) visible.push(n.id);
      }
      setViewport({ visibleNodeIds: visible, zoom: Math.round(t.k * 100) / 100 });
    }, 700);
    return () => window.clearInterval(timer);
  }, []);

  // --- focus(node_ids): the agent moves the analyst's view ------------------
  const flyTo = useCallback((ids: string[]): boolean => {
    const { w, h } = sizeRef.current;
    if (!w || !h) return false;
    const box = simRef.current.bounds(ids);
    if (!box) return false;

    // A single node, or several stacked before the simulation has separated
    // them, is a zero-extent box. viewport.frame() floors the extent, so it
    // yields a valid transform rather than dividing by nothing — this is
    // exactly the case that used to black the screen out.
    flightRef.current = {
      from: transformRef.current,
      to: frame(box, w, h, 110, ids.length === 1 ? 1.5 : 1.3),
      start: Date.now(),
    };
    userMovedView.current = true;
    return true;
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    if (flyTo(focusRequest.nodeIds)) return;
    // The node exists but the simulation has not placed it yet. Retry rather
    // than flying somewhere arbitrary.
    const retry = window.setTimeout(() => flyTo(focusRequest.nodeIds), 400);
    return () => window.clearTimeout(retry);
  }, [focusRequest, flyTo]);

  // --- Pointer interaction --------------------------------------------------
  const localPoint = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = localPoint(e);
    const positions = new Map(simRef.current.nodes.map((n) => [n.id, n]));
    const hit = hitTest(
      {
        nodes: scene.drawNodes,
        links: scene.drawLinks,
        positions,
        selection: new Set(selection),
        hovered,
        adjacent,
        path: null,
        time: 0,
        reducedMotion: true,
      },
      transformRef.current,
      x,
      y
    );

    e.currentTarget.setPointerCapture(e.pointerId);
    flightRef.current = null;

    if (hit) {
      dragRef.current = { id: hit, moved: false };
      const n = simRef.current.node(hit);
      if (n) {
        n.fx = n.x;
        n.fy = n.y;
      }
      setCursor("grabbing");
    } else {
      const t = transformRef.current;
      panRef.current = { x, y, tx: t.tx, ty: t.ty };
      setCursor("grabbing");
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [x, y] = localPoint(e);

    const drag = dragRef.current;
    if (drag) {
      const [wx, wy] = toWorld(transformRef.current, x, y);
      const n = simRef.current.node(drag.id);
      if (n) {
        n.fx = wx;
        n.fy = wy;
        drag.moved = true;
        simRef.current.reheat(0.35);
      }
      return;
    }

    const pan = panRef.current;
    if (pan) {
      transformRef.current = {
        ...transformRef.current,
        tx: pan.tx + (x - pan.x),
        ty: pan.ty + (y - pan.y),
      };
      userMovedView.current = true;
      return;
    }

    const positions = new Map(simRef.current.nodes.map((n) => [n.id, n]));
    const hit = hitTest(
      {
        nodes: scene.drawNodes,
        links: scene.drawLinks,
        positions,
        selection: new Set(selection),
        hovered,
        adjacent,
        path: null,
        time: 0,
        reducedMotion: true,
      },
      transformRef.current,
      x,
      y
    );
    if (hit !== hovered) setHovered(hit);
    setCursor(hit ? "pointer" : "grab");
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const drag = dragRef.current;
    if (drag) {
      const n = simRef.current.node(drag.id);
      if (n) {
        // Release the node back to the simulation. Pinning dragged nodes would
        // let the analyst build a layout the physics then contradicts.
        n.fx = undefined;
        n.fy = undefined;
      }
      if (!drag.moved) toggleSelection(drag.id);
      dragRef.current = null;
      setCursor("pointer");
      return;
    }

    const pan = panRef.current;
    if (pan) {
      const [x, y] = localPoint(e);
      if (Math.hypot(x - pan.x, y - pan.y) < 4) clearSelection();
      panRef.current = null;
    }
    setCursor("grab");
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const [x, y] = localPoint(e);
    flightRef.current = null;
    userMovedView.current = true;
    transformRef.current = zoomAbout(
      transformRef.current,
      x,
      y,
      Math.pow(0.999, e.deltaY * (e.deltaMode === 1 ? 16 : 1))
    );
  };

  // --- Keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") clearSelection();
      if (e.key.toLowerCase() === "f") {
        flyTo(selection.length ? selection : [...scene.drawNodes.keys()]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, flyTo, scene.drawNodes]);

  const zoomBy = (factor: number) => {
    const { w, h } = sizeRef.current;
    flightRef.current = null;
    userMovedView.current = true;
    transformRef.current = zoomAbout(transformRef.current, w / 2, h / 2, factor);
  };

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      {/* A canvas is opaque to assistive technology, so it carries a summary
          of what it holds. The Inspector and the Corpus panel are the
          navigable, readable equivalents of everything drawn here. */}
      <canvas
        ref={canvasRef}
        className="graph-canvas"
        role="img"
        aria-label={
          `Link chart: ${scene.drawNodes.size} entities, ${scene.drawLinks.length} relationships` +
          (selection.length ? `. ${selection.length} selected` : "") +
          (path?.found ? `. A path of ${path.hops} hops connects them` : "") +
          (path && !path.found ? ". No path connects them" : "")
        }
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => setHovered(null)}
        onWheel={onWheel}
      />

      <div className="canvas-controls">
        <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button className="icon-btn" onClick={() => zoomBy(0.8)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button
          className="icon-btn"
          onClick={() => flyTo(selection.length ? selection : [...scene.drawNodes.keys()])}
          title="Frame the selection (F)"
          aria-label="Frame the selection"
        >
          ⤢
        </button>
      </div>

      {path && (
        <div className={`path-readout ${path.found ? "found" : "none"}`}>
          {path.found ? (
            <>
              <strong>{path.hops} hop{path.hops === 1 ? "" : "s"}</strong>
              <span>between the two you selected</span>
            </>
          ) : (
            <>
              <strong>No path yet</strong>
              <span>
                nothing on this canvas connects them — that is a real answer,
                not a failure
              </span>
            </>
          )}
        </div>
      )}

      {/* A reminder, not a decoder ring — the glyph is on the node itself. */}
      <div className="canvas-legend">
        {NODE_KINDS.map((kind) => (
          <span key={kind}>
            <i className="swatch glyph" aria-hidden>
              {glyphs[kind]}
            </i>{" "}
            {kind}
          </span>
        ))}
        <span>
          <i className="swatch proposed" /> proposed
        </span>
      </div>

      {scene.drawNodes.size === 0 && (
        <div className="canvas-empty">
          <p>Nothing on the canvas yet.</p>
          <p className="dim">Search the corpus and add an entity, or mark one in a filing.</p>
        </div>
      )}
    </div>
  );
}
