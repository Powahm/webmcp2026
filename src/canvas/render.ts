import { glyphFor } from "./glyphs";
import { PALETTE, type NodeKind } from "./palette";
import { radiusFor, type SimNode } from "./simulation";
import { toScreen, type Transform } from "./viewport";

/**
 * Drawing.
 *
 * Deliberately flat and legible rather than spectacular: this is a link chart
 * you read, and the reading half of the product is a document. Every visual
 * difference below encodes state, dashed means unconfirmed, a warm line means
 * the analyst asserted it with no filing behind it, a dimmed node means it is
 * not on the path you are looking at. Nothing here is decoration.
 */

export interface DrawNode {
  id: string;
  type: NodeKind;
  label: string;
  proposed: boolean;
  weight: number;
  citations: number;
}

/**
 * A label short enough to sit under a node without colliding with its
 * neighbours. Addresses are the problem case, the full registered office
 * string is longer than the rest of the chart put together, so they keep the
 * building and the postcode, which is what identifies them to a reader anyway.
 * The Inspector shows the whole thing.
 */
/** A UK postcode, e.g. "SW16 6NR" or "IV15 9TS". */
const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** Bare country names Companies House addresses are routinely suffixed with.
 *  Every address here is in the UK, so keeping one of these as the second
 *  half of a node label carries no information. */
const COUNTRY_SUFFIXES = new Set([
  "UNITED KINGDOM",
  "ENGLAND",
  "SCOTLAND",
  "WALES",
  "NORTHERN IRELAND",
]);

export function shortLabel(label: string, type: NodeKind): string {
  if (type === "address") {
    const parts = label.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      const head = parts[0];

      // The postcode is the single most identifying token on the node, and
      // it is not reliably the last comma-separated part, real addresses
      // are routinely suffixed with the country. Scan from the end for the
      // first part that is actually shaped like a UK postcode.
      let tail: string | undefined;
      for (let i = parts.length - 1; i >= 1; i--) {
        if (UK_POSTCODE.test(parts[i])) {
          tail = parts[i];
          break;
        }
      }

      // No postcode-shaped part: fall back to the last part that is not a
      // bare country name, so "UNITED KINGDOM" isn't what survives.
      if (!tail) {
        for (let i = parts.length - 1; i >= 1; i--) {
          if (!COUNTRY_SUFFIXES.has(parts[i].toUpperCase())) {
            tail = parts[i];
            break;
          }
        }
      }

      // Every part was a country name (unexpected), keep the original
      // behaviour rather than producing an empty label.
      if (!tail) tail = parts[parts.length - 1];

      return `${head}, ${tail}`;
    }
  }
  return label.length > 30 ? `${label.slice(0, 28)}…` : label;
}

export interface DrawLink {
  source: string;
  target: string;
  proposed: boolean;
  asserted: boolean;
  corroborated: boolean;
}

export interface Scene {
  nodes: Map<string, DrawNode>;
  links: DrawLink[];
  positions: Map<string, SimNode>;
  selection: Set<string>;
  hovered: string | null;
  /** Neighbours of the hovered node, everything else dims. */
  adjacent: Set<string>;
  /**
   * The path between the two selected nodes, if there is one.
   *
   * This is the climax of the demo made visible: before the agent works, two
   * selected nodes have no path and the canvas says so; after the analyst
   * accepts, the same two nodes light a route through everything that was
   * found. Everything off the path dims, which is the only way a four-hop
   * chain is readable in a graph this size.
   */
  path: { nodes: Set<string>; edges: Set<string> } | null;
  time: number;
  reducedMotion: boolean;
}

/** Stable key for a link, order-independent. The simulation may hand us
 *  either end first. */
export const linkKey = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

const DPR = () => Math.min(2, globalThis.devicePixelRatio || 1);

export function resizeCanvas(canvas: HTMLCanvasElement, w: number, h: number): void {
  const dpr = DPR();
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

/** A faint dot grid, so panning has something to move against. Without it an
 *  empty canvas feels broken rather than empty. */
function drawGrid(ctx: CanvasRenderingContext2D, t: Transform, w: number, h: number): void {
  const step = 60 * t.k;
  if (step < 16) return;
  const alpha = Math.min(0.5, (step - 16) / 90);
  ctx.fillStyle = PALETTE.grid;
  ctx.globalAlpha = alpha;
  const ox = t.tx % step;
  const oy = t.ty % step;
  for (let x = ox; x < w; x += step) {
    for (let y = oy; y < h; y += step) {
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * How strongly to draw something.
 *
 * Full strength when nothing is focused. A highlighted path wins over hover,
 * because the path is a deliberate question the analyst asked and hover is
 * just where the mouse happens to be.
 */
function dimFactor(scene: Scene, id: string): number {
  if (scene.path) return scene.path.nodes.has(id) ? 1 : 0.12;
  if (!scene.hovered) return 1;
  if (id === scene.hovered || scene.adjacent.has(id)) return 1;
  return 0.22;
}

/** Links are dimmed by their own membership of the path, not by their ends.
 *  Two path nodes can be joined by an edge that is not on the route. */
function linkDim(scene: Scene, l: DrawLink): number {
  if (scene.path) return scene.path.edges.has(linkKey(l.source, l.target)) ? 1 : 0.08;
  return Math.min(dimFactor(scene, l.source), dimFactor(scene, l.target));
}

export function draw(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  t: Transform,
  w: number,
  h: number
): void {
  const dpr = DPR();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, t, w, h);

  ctx.lineCap = "round";

  // --- Links ---------------------------------------------------------------
  const dashPhase = scene.reducedMotion ? 0 : (scene.time / 34) % 16;

  for (const l of scene.links) {
    const a = scene.positions.get(l.source);
    const b = scene.positions.get(l.target);
    if (!a || !b) continue;

    const [x0, y0] = toScreen(t, a.x, a.y);
    const [x1, y1] = toScreen(t, b.x, b.y);

    const dim = linkDim(scene, l);
    ctx.globalAlpha = dim;

    if (l.proposed) {
      // Dashes read as "being asserted". A solid line reads as settled, and an
      // unconfirmed claim must never look like a confirmed one.
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = -dashPhase;
      ctx.strokeStyle = PALETTE.proposed;
      ctx.lineWidth = 1.7;
    } else {
      ctx.setLineDash([]);
      const onPath = scene.path?.edges.has(linkKey(l.source, l.target)) ?? false;
      ctx.strokeStyle = onPath
        ? PALETTE.text
        : l.asserted
          ? PALETTE.linkAsserted
          : l.corroborated
            ? PALETTE.linkStrong
            : PALETTE.link;
      ctx.lineWidth = onPath ? 2.6 : l.corroborated ? 2.1 : 1.4;
    }

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // --- Nodes ---------------------------------------------------------------
  // A proposal breathes, so an unconfirmed claim never sits still and gets
  // mistaken for part of the picture.
  const pulse = scene.reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(scene.time / 420);

  const labelScale = Math.min(1.15, Math.max(0.75, t.k));
  const showAllLabels = t.k > 0.62;

  /**
   * Occupied screen space. Discs go in first, then each label as it is placed,
   * so a label is dropped rather than drawn over a node or another label.
   * Overlapping text is the single thing that makes a link chart look broken,
   * and a dropped label costs nothing. The node is still there and hovering
   * brings its name straight back.
   */
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const placed: Box[] = [];
  const collides = (b: Box) =>
    placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);

  // Important nodes are laid out first so they win the labelling contest:
  // hovered, then selected, then proposals, then hubs.
  const priority = (n: DrawNode): number =>
    (scene.hovered === n.id ? 1000 : 0) +
    (scene.selection.has(n.id) ? 500 : 0) +
    (n.proposed ? 250 : 0) +
    n.weight;

  const ordered = [...scene.nodes.values()].sort((a, b) => priority(b) - priority(a));

  /** Everything the label pass needs, computed once during the disc pass. */
  const laid: { n: DrawNode; x: number; y: number; r: number; dim: number }[] = [];

  for (const n of ordered) {
    const p = scene.positions.get(n.id);
    if (!p) continue;
    const [x, y] = toScreen(t, p.x, p.y);
    const r = radiusFor(n.weight, n.proposed) * Math.min(1.4, Math.max(0.55, t.k));

    // Cheap cull. Nodes far outside the viewport cost nothing to skip.
    if (x < -200 || y < -200 || x > w + 200 || y > h + 200) continue;

    const selected = scene.selection.has(n.id);
    const hovered = scene.hovered === n.id;
    const dim = dimFactor(scene, n.id);
    // Every confirmed entity is the same ink. What kind of thing it is comes
    // from the glyph below; the colour is left free to mean state.
    const colour = n.proposed ? PALETTE.proposed : PALETTE.node;

    ctx.globalAlpha = dim;

    // Glow. The Obsidian read: colour bleeding softly into the background.
    const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * (n.proposed ? 4.2 : 3));
    glow.addColorStop(0, `${colour}${n.proposed ? "5c" : "3d"}`);
    glow.addColorStop(1, `${colour}00`);
    ctx.fillStyle = glow;
    ctx.globalAlpha = dim * (n.proposed ? pulse : 1);
    ctx.beginPath();
    ctx.arc(x, y, r * (n.proposed ? 4.2 : 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = dim;

    // Selection ring, outside the disc so it never changes the node's size.
    if (selected) {
      ctx.strokeStyle = PALETTE.text;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, r + 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (n.proposed) {
      // Hollow: it is a shape waiting to be filled in.
      ctx.fillStyle = PALETTE.bg;
      ctx.fill();
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = colour;
      ctx.fill();
      if (hovered || selected) {
        ctx.strokeStyle = PALETTE.text;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // The glyph. This is what says *what the node is*, the reason the discs
    // are all one colour. Below roughly nine pixels a symbol stops being a
    // symbol and becomes a smudge, so at that point we draw nothing rather
    // than something illegible; zooming in brings it straight back.
    const glyph = glyphFor(n.type);
    if (glyph && r >= 9) {
      ctx.save();
      ctx.font = `${Math.round(r * 1.05)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = dim * (n.proposed ? 0.9 : 1);
      ctx.fillStyle = PALETTE.text;
      ctx.fillText(glyph, x, y);
      ctx.restore();
    }

    placed.push({ x0: x - r - 2, y0: y - r - 2, x1: x + r + 2, y1: y + r + 2 });
    laid.push({ n, x, y, r, dim });
    ctx.globalAlpha = 1;
  }

  // --- Labels, in a second pass --------------------------------------------
  // Separate from the discs so a label can be tested against every node on
  // screen, not only the ones drawn before it.
  const size = Math.round(11.5 * labelScale);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";

  for (const { n, x, y, r, dim } of laid) {
    const selected = scene.selection.has(n.id);
    const hovered = scene.hovered === n.id;
    const onPath = scene.path?.nodes.has(n.id) ?? false;
    if (!(showAllLabels || hovered || selected || n.proposed || onPath || n.weight >= 3)) continue;

    ctx.font = `${selected || hovered ? 600 : 500} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
    const label = shortLabel(n.label, n.type);
    const ly = y + r + 9;
    const halfWidth = ctx.measureText(label).width / 2;
    const box = { x0: x - halfWidth - 3, y0: ly - 2, x1: x + halfWidth + 3, y1: ly + size + 3 };

    // Three cases always keep their label whatever it overlaps: the node the
    // analyst is pointing at, the one they selected, and any proposal. An
    // unlabelled proposal is the one thing on this canvas nobody can act on.
    if (!hovered && !selected && !n.proposed && !onPath && collides(box)) continue;
    placed.push(box);

    ctx.globalAlpha = dim;
    // A halo rather than a filled box: a box the width of the text turns the
    // canvas into a wall of rectangles once the working set grows.
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = PALETTE.halo;
    ctx.strokeText(label, x, ly);
    ctx.fillStyle = hovered || selected ? PALETTE.text : PALETTE.textDim;
    ctx.fillText(label, x, ly);
  }

  ctx.globalAlpha = 1;
}

/** Topmost node under a screen point, or null. Iterates in reverse so the
 *  node drawn last, the one visually on top, is the one you hit. */
export function hitTest(
  scene: Scene,
  t: Transform,
  sx: number,
  sy: number
): string | null {
  const entries = [...scene.nodes.values()];
  for (let i = entries.length - 1; i >= 0; i--) {
    const n = entries[i];
    const p = scene.positions.get(n.id);
    if (!p) continue;
    const [x, y] = toScreen(t, p.x, p.y);
    const r = radiusFor(n.weight, n.proposed) * Math.min(1.4, Math.max(0.55, t.k));
    // A generous target: precise clicking on a moving disc is miserable.
    const hit = Math.max(r + 6, 12);
    if ((sx - x) ** 2 + (sy - y) ** 2 <= hit * hit) return n.id;
  }
  return null;
}
