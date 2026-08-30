/**
 * A small 2D force simulation.
 *
 * Hand-rolled, and that is the point. The previous canvas used
 * react-force-graph-3d, which pulls its own copy of three.js; a version skew
 * between that copy and ours put two three.js builds on the page and one of
 * them called a method on a matrix from the other. Hard page error on every
 * load. This file has no dependencies at all, so that entire class of bug
 * cannot recur.
 *
 * Naive O(n²) repulsion. The canvas holds a working set of tens of nodes, not
 * the corpus — forty nodes is 1,600 pairs a frame, which is nothing. If the
 * working set ever reaches the hundreds, that is a product problem before it is
 * a performance one.
 *
 * The physics still carries meaning: a proposal hangs on a weak, long spring so
 * it visibly floats unsettled at the edge of the cluster, and accepting it
 * tightens the spring so the graph contracts around the new fact.
 */

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Set while the analyst is dragging: the simulation stops moving it. */
  fx?: number;
  fy?: number;
  /** More connections, more mass — hubs sit still and leaves swing. */
  weight: number;
}

export interface SimLink {
  source: string;
  target: string;
  distance: number;
  strength: number;
}

export const SIM = {
  /** Node-node repulsion. Negative is apart. */
  charge: -1500,
  /** Beyond this, nodes stop pushing at all — keeps distant clusters from
   *  inflating the whole layout. */
  chargeDistanceMax: 620,
  /** Pull towards the centre of the canvas. Mild: the working set should stay
   *  on screen without being crushed together. */
  centerStrength: 0.02,
  /** Nodes are drawn as discs; this stops them overlapping. */
  collisionPadding: 16,

  linkDistanceConfirmed: 150,
  linkDistanceProposed: 280,
  linkStrengthConfirmed: 0.55,
  /** The weak spring. A proposal drifts; a fact is held. */
  linkStrengthProposed: 0.06,

  velocityDecay: 0.62,
  alphaMin: 0.006,
  alphaDecay: 0.018,
  alphaTarget: 0,
} as const;

export const linkDistanceFor = (proposed: boolean, acceptT = 1): number =>
  proposed
    ? SIM.linkDistanceProposed
    : SIM.linkDistanceProposed +
      (SIM.linkDistanceConfirmed - SIM.linkDistanceProposed) * acceptT;

export const linkStrengthFor = (proposed: boolean, acceptT = 1): number =>
  proposed
    ? SIM.linkStrengthProposed
    : SIM.linkStrengthProposed +
      (SIM.linkStrengthConfirmed - SIM.linkStrengthProposed) * acceptT;

/** Radius in world units. Hubs read bigger, the way they do in Obsidian. */
export const radiusFor = (weight: number, proposed: boolean): number =>
  (proposed ? 7 : 8) + Math.min(9, Math.sqrt(weight) * 3.2);

export class Simulation {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  alpha = 1;

  private index = new Map<string, SimNode>();

  node(id: string): SimNode | undefined {
    return this.index.get(id);
  }

  /**
   * Replace the graph, keeping positions for nodes that survive.
   *
   * New nodes are seeded near an existing neighbour rather than at the origin.
   * A node dropped at (0,0) flies across the screen on its first few frames,
   * which reads as a glitch — and, in the 3D version, a focus computed on a
   * node still sitting at the origin put the camera inside the world and
   * blacked the screen out. Placing it next to something it is attached to
   * avoids the whole family of problems.
   */
  setGraph(nodes: { id: string; weight: number }[], links: SimLink[]): void {
    const next: SimNode[] = [];
    const nextIndex = new Map<string, SimNode>();

    const neighbourOf = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      const list = neighbourOf.get(a);
      if (list) list.push(b);
      else neighbourOf.set(a, [b]);
    };
    for (const l of links) {
      link(l.source, l.target);
      link(l.target, l.source);
    }

    for (const n of nodes) {
      const existing = this.index.get(n.id);
      if (existing) {
        existing.weight = n.weight;
        next.push(existing);
        nextIndex.set(n.id, existing);
        continue;
      }

      // Seed beside a neighbour that already has a position, if there is one.
      let ox = 0;
      let oy = 0;
      for (const other of neighbourOf.get(n.id) ?? []) {
        const placed = this.index.get(other);
        if (placed) {
          ox = placed.x;
          oy = placed.y;
          break;
        }
      }
      const angle = Math.random() * Math.PI * 2;
      const spread = ox === 0 && oy === 0 ? 90 + Math.random() * 90 : 120;
      const fresh: SimNode = {
        id: n.id,
        x: ox + Math.cos(angle) * spread,
        y: oy + Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
        weight: n.weight,
      };
      next.push(fresh);
      nextIndex.set(n.id, fresh);
    }

    this.nodes = next;
    this.index = nextIndex;
    this.links = links.filter((l) => nextIndex.has(l.source) && nextIndex.has(l.target));
  }

  reheat(alpha = 0.85): void {
    this.alpha = Math.max(this.alpha, alpha);
  }

  get settled(): boolean {
    return this.alpha <= SIM.alphaMin;
  }

  /** One step. Returns false when the layout has settled and can stop. */
  tick(): boolean {
    if (this.alpha <= SIM.alphaMin) {
      this.alpha = SIM.alphaMin;
      return false;
    }
    this.alpha += (SIM.alphaTarget - this.alpha) * SIM.alphaDecay;

    const nodes = this.nodes;
    const a = this.alpha;

    // Repulsion + collision, one pass over the pairs.
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      const rp = radiusFor(p.weight, false);
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;

        // Two nodes at the identical point have no direction to separate along.
        // Nudge deterministically rather than dividing by zero.
        if (d2 < 1e-6) {
          dx = (i - j) * 0.5 || 0.5;
          dy = 0.5;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > SIM.chargeDistanceMax * SIM.chargeDistanceMax) continue;

        const d = Math.sqrt(d2);
        const force = (SIM.charge * a) / d2;
        const ux = dx / d;
        const uy = dy / d;
        p.vx += ux * force;
        p.vy += uy * force;
        q.vx -= ux * force;
        q.vy -= uy * force;

        const minDist = rp + radiusFor(q.weight, false) + SIM.collisionPadding;
        if (d < minDist) {
          const push = (minDist - d) * 0.5;
          p.vx -= ux * push;
          p.vy -= uy * push;
          q.vx += ux * push;
          q.vy += uy * push;
        }
      }
    }

    // Springs.
    for (const l of this.links) {
      const s = this.index.get(l.source);
      const t = this.index.get(l.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.hypot(dx, dy) || 1e-3;
      const k = ((d - l.distance) / d) * l.strength * a;
      const fx = dx * k;
      const fy = dy * k;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    // Centring and integration.
    for (const n of nodes) {
      if (n.fx !== undefined && n.fy !== undefined) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx -= n.x * SIM.centerStrength * a;
      n.vy -= n.y * SIM.centerStrength * a;
      n.vx *= SIM.velocityDecay;
      n.vy *= SIM.velocityDecay;
      n.x += n.vx;
      n.y += n.vy;
    }

    return true;
  }

  /** Bounding box of the given ids, or of everything. Used to frame the view. */
  bounds(ids?: string[]): { x0: number; y0: number; x1: number; y1: number } | null {
    const set = ids?.length ? new Set(ids) : null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let count = 0;
    for (const n of this.nodes) {
      if (set && !set.has(n.id)) continue;
      const r = radiusFor(n.weight, false);
      x0 = Math.min(x0, n.x - r);
      y0 = Math.min(y0, n.y - r);
      x1 = Math.max(x1, n.x + r);
      y1 = Math.max(y1, n.y + r);
      count++;
    }
    return count ? { x0, y0, x1, y1 } : null;
  }
}
