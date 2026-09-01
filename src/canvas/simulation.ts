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
  /** Which connected component this node belongs to. Assigned in setGraph and
   *  used to keep separate clusters apart without squashing either of them. */
  comp: number;
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

  /**
   * There is deliberately no pull towards the world centre.
   *
   * A centring force is proportional to a node's distance from the origin, so
   * it fights the springs and the repulsion everywhere at once: two clusters
   * that should sit apart get dragged into each other, and a wide chart gets
   * compressed into a ball. The springs already hold a component together —
   * that is what a spring is for — so the only two jobs left are keeping
   * separate components off each other, and keeping the whole picture from
   * wandering off screen. Those are the two constants below, and neither one
   * distorts a cluster's shape.
   */

  /** Repulsion between the centroids of separate components, applied to every
   *  node in each — so a cluster is translated away from its neighbour rather
   *  than stretched towards it. */
  clusterSeparation: 120_000,
  /** Below this the separation force stops growing, so two components that
   *  land on top of each other part firmly instead of exploding. */
  clusterMinDistance: 140,
  /**
   * Beyond this, two components stop pushing each other altogether.
   *
   * Without a ceiling the inverse-square decays but never reaches zero, so
   * every pair of clusters keeps accelerating apart for as long as the
   * simulation is warm — and dragging holds it warm, because pointermove
   * reheats on every event. Worse, clusters spread *symmetrically*, so the mean
   * of the centroids barely moves and driftCorrection never sees a problem to
   * correct. That combination is the drift off screen. A component that is
   * already this far away is not crowding anything, so it needs no push.
   */
  clusterDistanceMax: 760,
  /**
   * How far a component's centroid may sit from the layout centroid before it
   * is eased back.
   *
   * Scaled by sqrt(component count), so a six-cluster board is allowed to be
   * wider than a two-cluster one. This is a budget the layout grows into, not a
   * wall: nothing is ever clamped to a fixed box, which would break the moment
   * the analyst added one more cluster than the box was sized for.
   */
  clusterSpreadRadius: 200,
  /** Strength of that easing. Deliberately weak — it should read as the picture
   *  settling back into view, never as a cluster being yanked. */
  clusterContainment: 0.08,
  /**
   * Recentring. Applied as one identical vector to every node, which makes it
   * a pure translation of the whole layout: it can move the picture back into
   * view, and it cannot change the shape of anything in it.
   */
  driftCorrection: 0.012,

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

/**
 * Radius in world units. Hubs read bigger, the way they do in Obsidian.
 *
 * The floor is set by the glyph rather than by taste: a disc smaller than about
 * nine world units cannot carry a legible symbol, and a node whose type you
 * cannot read is a dot.
 */
export const radiusFor = (weight: number, proposed: boolean): number =>
  (proposed ? 9 : 10) + Math.min(10, Math.sqrt(weight) * 3.4);

export class Simulation {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  alpha = 1;
  /** How many connected components the current graph has. */
  components = 0;

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
        comp: 0,
      };
      next.push(fresh);
      nextIndex.set(n.id, fresh);
    }

    this.nodes = next;
    this.index = nextIndex;
    this.links = links.filter((l) => nextIndex.has(l.source) && nextIndex.has(l.target));
    this.labelComponents();
  }

  /**
   * Label each node with its connected component.
   *
   * A flood fill over the adjacency, which is cheap at this size and only runs
   * when the graph changes. Every unconnected node is its own component, which
   * is exactly right: a lone entity the analyst dropped on the canvas should be
   * pushed clear of the cluster it is not part of, not absorbed into it.
   */
  private labelComponents(): void {
    const adjacency = new Map<string, string[]>();
    const join = (a: string, b: string) => {
      const list = adjacency.get(a);
      if (list) list.push(b);
      else adjacency.set(a, [b]);
    };
    for (const l of this.links) {
      join(l.source, l.target);
      join(l.target, l.source);
    }

    for (const n of this.nodes) n.comp = -1;

    let comp = 0;
    for (const start of this.nodes) {
      if (start.comp !== -1) continue;
      const queue = [start];
      start.comp = comp;
      while (queue.length) {
        const node = queue.pop()!;
        for (const id of adjacency.get(node.id) ?? []) {
          const other = this.index.get(id);
          if (other && other.comp === -1) {
            other.comp = comp;
            queue.push(other);
          }
        }
      }
      comp++;
    }
    this.components = comp;
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

    // Cluster forces, and the one correction that keeps the picture on screen.
    this.applyClusterForces(a);

    // Integration.
    for (const n of nodes) {
      if (n.fx !== undefined && n.fy !== undefined) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= SIM.velocityDecay;
      n.vy *= SIM.velocityDecay;
      n.x += n.vx;
      n.y += n.vy;
    }

    return true;
  }

  /**
   * Keep separate clusters off each other, and the whole picture in view.
   *
   * Both forces act on a component as a whole rather than on nodes
   * individually, so neither can distort the shape the springs worked out. That
   * is the difference from the centring force this replaced: a cluster is moved
   * here, never squeezed.
   */
  private applyClusterForces(a: number): void {
    const count = this.components;
    if (count === 0) return;

    const sumX = new Float64Array(count);
    const sumY = new Float64Array(count);
    const size = new Float64Array(count);
    for (const n of this.nodes) {
      sumX[n.comp] += n.x;
      sumY[n.comp] += n.y;
      size[n.comp]++;
    }
    for (let c = 0; c < count; c++) {
      if (size[c]) {
        sumX[c] /= size[c];
        sumY[c] /= size[c];
      }
    }

    // Separation. Every pair of components pushes apart along the line between
    // their centroids, and every node in a component gets the same push.
    if (count > 1) {
      const pushX = new Float64Array(count);
      const pushY = new Float64Array(count);

      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          let dx = sumX[j] - sumX[i];
          let dy = sumY[j] - sumY[i];
          let d = Math.hypot(dx, dy);
          if (d < 1e-3) {
            // Coincident centroids have no direction to separate along.
            dx = 1;
            dy = (i % 2 === 0 ? 1 : -1) * 0.6;
            d = Math.hypot(dx, dy);
          }
          // Far-apart components are not crowding each other. Skipping them
          // is what stops the runaway; see clusterDistanceMax.
          if (d > SIM.clusterDistanceMax) continue;

          const clamped = Math.max(d, SIM.clusterMinDistance);
          const force = (SIM.clusterSeparation * a) / (clamped * clamped);
          const ux = dx / d;
          const uy = dy / d;
          pushX[i] -= ux * force;
          pushY[i] -= uy * force;
          pushX[j] += ux * force;
          pushY[j] += uy * force;
        }
      }

      for (const n of this.nodes) {
        if (n.fx !== undefined) continue;
        n.vx += pushX[n.comp];
        n.vy += pushY[n.comp];
      }
    }

    // Containment. A component whose centroid has wandered past the spread
    // budget is eased back towards the middle of the layout — again as one
    // shared vector per component, so it translates rather than deforms. This
    // is the backstop: separation can no longer push a cluster to infinity, and
    // anything that gets far out for another reason drifts back on its own.
    if (count > 1) {
      let cx = 0;
      let cy = 0;
      for (let c = 0; c < count; c++) {
        cx += sumX[c];
        cy += sumY[c];
      }
      cx /= count;
      cy /= count;

      const budget = SIM.clusterSpreadRadius * Math.sqrt(count);
      const pullX = new Float64Array(count);
      const pullY = new Float64Array(count);
      let engaged = false;

      for (let c = 0; c < count; c++) {
        const dx = sumX[c] - cx;
        const dy = sumY[c] - cy;
        const d = Math.hypot(dx, dy);
        if (d <= budget || d < 1e-3) continue;
        const pull = (d - budget) * SIM.clusterContainment * a;
        pullX[c] = -(dx / d) * pull;
        pullY[c] = -(dy / d) * pull;
        engaged = true;
      }

      if (engaged) {
        for (const n of this.nodes) {
          if (n.fx !== undefined) continue;
          n.vx += pullX[n.comp];
          n.vy += pullY[n.comp];
        }
      }
    }

    // Recentring, as one shared vector: a translation, not a compression.
    let gx = 0;
    let gy = 0;
    for (let c = 0; c < count; c++) {
      gx += sumX[c];
      gy += sumY[c];
    }
    gx = (gx / count) * SIM.driftCorrection * a;
    gy = (gy / count) * SIM.driftCorrection * a;
    if (gx === 0 && gy === 0) return;
    for (const n of this.nodes) {
      if (n.fx !== undefined) continue;
      n.vx -= gx;
      n.vy -= gy;
    }
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
