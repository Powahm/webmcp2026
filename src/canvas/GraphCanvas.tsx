import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import {
  clearSelection,
  setViewport,
  toggleSelection,
} from "../state/actions";
import { useGraphStore } from "../state/graphStore";
import { pendingProposals, useProposalStore } from "../state/proposalStore";
import { centroid, focusTransitionMs, framingDistance, type Vec3 } from "./camera";
import {
  linkColour,
  linkWidthFor,
  makeProposedLink,
  tickDashes,
  updateProposedLink,
} from "./linkObjects";
import { buildNodeObject, tickPulse, type NodeView } from "./nodeObjects";
import { PALETTE, prefersReducedMotion, type NodeKind } from "./palette";
import { acceptProgress, FORCE, linkDistanceFor, linkStrengthFor } from "./physics";

/**
 * The spatial layer.
 *
 * Everything that has to be *read carefully* lives in the 2D panels beside this
 * canvas. That split is what pays back the readability cost of 3D — see
 * docs/UI-3D.md.
 */

interface GNode {
  id: string;
  type: NodeKind;
  label: string;
  proposed: boolean;
  degree: number;
  justAccepted?: number;
  x?: number;
  y?: number;
  z?: number;
}

interface GLink {
  source: string;
  target: string;
  relation: string;
  proposed: boolean;
  derived?: boolean;
  analystAsserted?: boolean;
  evidenceCount: number;
  justAccepted?: number;
}

export default function GraphCanvas() {
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastInteraction = useRef<number>(Date.now());
  const framedOnce = useRef(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selection = useGraphStore((s) => s.selection);
  const focusRequest = useGraphStore((s) => s.focusRequest);
  const reheat = useGraphStore((s) => s.reheat);
  const proposalMap = useProposalStore((s) => s.proposals);

  const pending = useMemo(() => pendingProposals(proposalMap), [proposalMap]);

  // --- Graph data: confirmed nodes and edges, plus pending proposals ---------
  const data = useMemo(() => {
    const degree = new Map<string, number>();
    const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const e of edges.values()) {
      bump(e.from_id);
      bump(e.to_id);
    }

    const gNodes: GNode[] = [...nodes.values()].map((n) => ({
      id: n.id,
      type: n.type as NodeKind,
      label: n.label,
      proposed: false,
      degree: degree.get(n.id) ?? 0,
      justAccepted: n.justAccepted,
    }));

    const gLinks: GLink[] = [...edges.values()].map((e) => ({
      source: e.from_id,
      target: e.to_id,
      relation: e.relation,
      proposed: false,
      derived: e.derived,
      analystAsserted: e.analystAsserted,
      evidenceCount: e.citations.length + (e.citations[0]?.corroborating?.length ?? 0),
      justAccepted: e.justAccepted,
    }));

    const present = new Set(gNodes.map((n) => n.id));

    for (const p of pending) {
      if (p.kind === "node") {
        if (present.has(p.node_id)) continue;
        present.add(p.node_id);
        gNodes.push({
          id: p.node_id,
          type: p.entityType as NodeKind,
          label: p.label,
          proposed: true,
          degree: 0,
        });
      }
    }
    for (const p of pending) {
      if (p.kind !== "edge") continue;
      if (!present.has(p.from_id) || !present.has(p.to_id)) continue;
      gLinks.push({
        source: p.from_id,
        target: p.to_id,
        relation: p.relation,
        proposed: true,
        evidenceCount: 1,
      });
    }

    return { nodes: gNodes, links: gLinks };
  }, [nodes, edges, pending]);

  /** The three highest-degree nodes carry a permanent label. Everything else is
   *  labelled only when the analyst points at it or the agent proposes it. */
  const hubs = useMemo(() => {
    const ranked = [...data.nodes]
      .filter((n) => !n.proposed)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 3)
      .filter((n) => n.degree >= 2);
    return new Set(ranked.map((n) => n.id));
  }, [data.nodes]);

  // --- Forces ---------------------------------------------------------------
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    const charge = fg.d3Force("charge");
    charge?.strength(FORCE.charge).distanceMax(FORCE.chargeDistanceMax);

    const center = fg.d3Force("center");
    center?.strength?.(FORCE.centerStrength);

    const link = fg.d3Force("link");
    if (link) {
      const now = () => Date.now();
      const reduced = prefersReducedMotion();
      link
        .distance((l: GLink) =>
          linkDistanceFor(l.proposed, acceptProgress(l.justAccepted, now(), reduced))
        )
        .strength((l: GLink) =>
          linkStrengthFor(l.proposed, acceptProgress(l.justAccepted, now(), reduced))
        );
    }
  }, [data]);

  /**
   * The money shot. An accept changed a spring, so the simulation is reheated
   * and the graph contracts around the new fact. Re-applied on a short interval
   * for the length of the animation so the springs tighten gradually rather
   * than snapping.
   */
  useEffect(() => {
    if (!reheat) return;
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3ReheatSimulation();
    const started = Date.now();
    const duration = prefersReducedMotion() ? 220 : 760;
    const timer = window.setInterval(() => {
      const fgNow = fgRef.current;
      if (!fgNow || Date.now() - started > duration) {
        window.clearInterval(timer);
        return;
      }
      const link = fgNow.d3Force("link");
      const reduced = prefersReducedMotion();
      link
        ?.distance((l: GLink) =>
          linkDistanceFor(l.proposed, acceptProgress(l.justAccepted, Date.now(), reduced))
        )
        .strength((l: GLink) =>
          linkStrengthFor(l.proposed, acceptProgress(l.justAccepted, Date.now(), reduced))
        );
      fgNow.d3ReheatSimulation();
    }, 60);
    return () => window.clearInterval(timer);
  }, [reheat]);

  /** Depth fog matched to the background, so distant nodes recede instead of
   *  cluttering. One of the readability mitigations 3D has to pay for itself. */
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.scene().fog = new THREE.Fog(PALETTE.bg, 260, 900);
  }, []);

  /** Frame the seed once. Without it the graph boots off-centre and small, and
   *  the analyst's first action is a pan rather than a question.
   *
   *  Done on a timer as well as on engine-stop: the simulation runs for several
   *  seconds, and waiting that long to frame the view looks broken. */
  const frameOnce = useCallback(() => {
    if (framedOnce.current) return;
    framedOnce.current = true;
    fgRef.current?.zoomToFit(700, 80);
  }, []);

  useEffect(() => {
    if (!data.nodes.length) return;
    const t = window.setTimeout(frameOnce, 2400);
    return () => window.clearTimeout(t);
  }, [data.nodes.length, frameOnce]);

  // --- focus(node_ids): the agent moves the analyst's view ------------------
  useEffect(() => {
    if (!focusRequest) return;
    const fg = fgRef.current;
    if (!fg) return;
    const points = data.nodes
      .filter((n) => focusRequest.nodeIds.includes(n.id))
      .map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }) as Vec3);
    if (!points.length) return;

    const c = centroid(points);
    const dist = framingDistance(points, c);
    const len = Math.hypot(c.x, c.y, c.z) || 1;
    fg.cameraPosition(
      { x: c.x + (c.x / len) * dist, y: c.y + (c.y / len) * dist * 0.4, z: c.z + (c.z / len) * dist },
      c,
      focusTransitionMs()
    );
  }, [focusRequest, data.nodes]);

  // --- Per-frame: pulse the proposal materials, report the viewport ---------
  const onEngineTick = useCallback(() => {
    const t = performance.now();
    tickPulse(t);
    tickDashes(t);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const fg = fgRef.current;
      if (!fg) return;
      const cam = fg.camera();
      const visible: string[] = [];
      const frustum = new THREE.Frustum();
      frustum.setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
      );
      for (const n of data.nodes) {
        if (n.x === undefined) continue;
        if (frustum.containsPoint(new THREE.Vector3(n.x, n.y, n.z))) visible.push(n.id);
      }
      setViewport({
        visibleNodeIds: visible,
        cameraDistance: Math.round(Math.hypot(cam.position.x, cam.position.y, cam.position.z)),
      });
    }, 600);
    return () => window.clearInterval(timer);
  }, [data.nodes]);

  // --- Idle auto-rotate -----------------------------------------------------
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      const fg = fgRef.current;
      if (!fg) return;
      if (Date.now() - lastInteraction.current < 20_000) return;
      const cam = fg.camera();
      const angle = (0.3 * Math.PI * dt) / 180;
      const { x, z } = cam.position;
      cam.position.x = x * Math.cos(angle) - z * Math.sin(angle);
      cam.position.z = x * Math.sin(angle) + z * Math.cos(angle);
      cam.lookAt(0, 0, 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- Interaction ----------------------------------------------------------
  const noteInteraction = useCallback(() => {
    lastInteraction.current = Date.now();
  }, []);

  const handleNodeClick = useCallback(
    (node: GNode) => {
      noteInteraction();
      toggleSelection(node.id);
    },
    [noteInteraction]
  );

  const handleBackgroundClick = useCallback(() => {
    noteInteraction();
    clearSelection();
  }, [noteInteraction]);

  const handleNodeDoubleClick = useCallback(
    (node: GNode) => {
      noteInteraction();
      const fg = fgRef.current;
      if (!fg || node.x === undefined) return;
      const dist = 110;
      const len = Math.hypot(node.x, node.y ?? 0, node.z ?? 0) || 1;
      fg.cameraPosition(
        {
          x: node.x + (node.x / len) * dist,
          y: (node.y ?? 0) + ((node.y ?? 0) / len) * dist,
          z: (node.z ?? 0) + ((node.z ?? 0) / len) * dist,
        },
        { x: node.x, y: node.y ?? 0, z: node.z ?? 0 },
        focusTransitionMs()
      );
    },
    [noteInteraction]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Escape") clearSelection();
      if (e.key.toLowerCase() === "f" && selection.length) {
        const fg = fgRef.current;
        if (!fg) return;
        const points = data.nodes
          .filter((n) => selection.includes(n.id))
          .map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }));
        if (!points.length) return;
        const c = centroid(points);
        const dist = framingDistance(points, c);
        const len = Math.hypot(c.x, c.y, c.z) || 1;
        fg.cameraPosition(
          { x: c.x + (c.x / len) * dist, y: c.y, z: c.z + (c.z / len) * dist },
          c,
          focusTransitionMs()
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, data.nodes]);

  // --- Rendering ------------------------------------------------------------
  const nodeThreeObject = useCallback(
    (node: GNode) => {
      const view: NodeView = {
        id: node.id,
        type: node.type,
        label: node.label,
        proposed: node.proposed,
        selected: selection.includes(node.id),
        hovered: hovered === node.id,
        isHub: hubs.has(node.id),
        degree: node.degree,
      };
      return buildNodeObject(view);
    },
    [selection, hovered, hubs]
  );

  const linkColor = useCallback((l: GLink) => linkColour(l.proposed, l.analystAsserted), []);

  const linkWidth = useCallback((l: GLink) => linkWidthFor(l.proposed, l.evidenceCount), []);

  /** Only proposals get a custom object; returning null leaves the default
   *  solid line in place for everything else. */
  const linkThreeObject = useCallback(
    (l: GLink) => (l.proposed ? makeProposedLink() : null),
    []
  );

  const linkPositionUpdate = useCallback(
    (
      obj: THREE.Object3D,
      coords: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } },
      l: GLink
    ) => {
      if (!l.proposed) return false;
      updateProposedLink(obj as THREE.Line, coords.start, coords.end);
      return true;
    },
    []
  );

  return (
    <div
      className="canvas-wrap"
      ref={wrapRef}
      onPointerDown={noteInteraction}
      onWheel={noteInteraction}
    >
      <ForceGraph3D<GNode, GLink>
        ref={fgRef as never}
        graphData={data}
        backgroundColor={PALETTE.bg}
        showNavInfo={false}
        nodeThreeObject={nodeThreeObject as never}
        nodeLabel={(n: GNode) => `${n.label}`}
        nodeRelSize={5}
        linkColor={linkColor as never}
        linkWidth={linkWidth as never}
        linkOpacity={0.9}
        // Dashes read as "being asserted"; a solid line reads as settled.
        // react-force-graph-3d has no dashed-link prop, so proposals carry a
        // real THREE.Line with a dash phase advanced every tick.
        linkThreeObject={linkThreeObject as never}
        linkPositionUpdate={linkPositionUpdate as never}
        // Particles flow only on corroborated edges, so they mean something.
        linkDirectionalParticles={((l: GLink) =>
          !l.proposed && l.evidenceCount > 1 ? 2 : 0) as never}
        linkDirectionalParticleSpeed={0.006}
        linkDirectionalParticleWidth={1.4}
        onNodeHover={((n: GNode | null) => setHovered(n?.id ?? null)) as never}
        onNodeClick={handleNodeClick as never}
        onNodeRightClick={handleNodeDoubleClick as never}
        onBackgroundClick={handleBackgroundClick}
        onEngineTick={onEngineTick}
        onEngineStop={frameOnce}
        enableNodeDrag
        cooldownTime={8_000}
      />
    </div>
  );
}
