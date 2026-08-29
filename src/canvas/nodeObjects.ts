import * as THREE from "three";
import { colourFor, PALETTE, prefersReducedMotion, type NodeKind } from "./palette";

/**
 * A mesh per entity type, and a material per state.
 *
 * Every choice here encodes something true (docs/UI-3D.md). Geometry says what
 * kind of thing a node is; material says how much we believe it. A proposal is
 * wireframed, semi-transparent and pulsing — it should look unsettled, because
 * it is.
 */

export interface NodeView {
  id: string;
  type: NodeKind;
  label: string;
  proposed?: boolean;
  selected?: boolean;
  hovered?: boolean;
  dimmed?: boolean;
  /** Degree centrality, used for size. Clamped so a hub reads as a hub without
   *  dwarfing everything else. */
  degree?: number;
  /** One of the few highest-degree nodes on the canvas. Earns a permanent
   *  label; everything else has to be pointed at. */
  isHub?: boolean;
}

const BASE_SIZE = 5;
const MAX_SCALE = 2.1;

function sizeFor(degree = 0): number {
  return BASE_SIZE * Math.min(MAX_SCALE, 1 + Math.log2(1 + degree) * 0.28);
}

function geometryFor(type: NodeKind, s: number): THREE.BufferGeometry {
  switch (type) {
    // Institutional, rectilinear.
    case "company":
      return new THREE.BoxGeometry(s * 1.5, s * 1.1, s * 1.1);
    // The only organic form on the canvas.
    case "person":
      return new THREE.SphereGeometry(s * 0.75, 20, 16);
    // Reads as a place, and sits flat.
    case "address":
      return new THREE.OctahedronGeometry(s * 0.85, 0);
    // A page.
    case "document":
      return new THREE.PlaneGeometry(s * 1.3, s * 1.7);
  }
}

/** Registry of the pulsing materials, ticked once per frame by the canvas. */
const pulsing = new Set<THREE.MeshStandardMaterial>();

export function tickPulse(timeMs: number): void {
  if (prefersReducedMotion()) return;
  // ~0.8 Hz. Slow enough to read as breathing rather than blinking.
  const v = 0.55 + 0.45 * Math.sin((timeMs / 1000) * Math.PI * 2 * 0.8);
  for (const m of pulsing) m.emissiveIntensity = 0.5 + v * 1.5;
}

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
    if (mat instanceof THREE.MeshStandardMaterial) pulsing.delete(mat);
  });
}

/** Camera-facing text.
 *
 * Sized in world units, not pixels: a label is about one node tall. Labelling
 * everything is what makes 3D graphs unusable, so the caller decides who gets
 * one — see the label rule in buildNodeObject. */
const LABEL_HEIGHT = 4.2;

function labelSprite(text: string, colour: string): THREE.Sprite {
  const dpr = 2;
  const fontPx = 26;
  const padX = 10;
  const font = `500 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const textW = Math.ceil(measure.measureText(text).width);
  const w = textW + padX * 2;
  const h = Math.round(fontPx * 1.5);

  const canvas = document.createElement("canvas");
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.font = font;

  // A quiet plate rather than a box: enough to keep the text legible against
  // a node behind it, not enough to become the thing you look at.
  ctx.fillStyle = "rgba(11,14,18,0.62)";
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 4);
  ctx.fill();

  ctx.fillStyle = colour;
  ctx.textBaseline = "middle";
  ctx.fillText(text, padX, h / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
    })
  );
  sprite.renderOrder = 10;
  sprite.scale.set((w / h) * LABEL_HEIGHT, LABEL_HEIGHT, 1);
  return sprite;
}

/** A flat ring that always faces the camera — the selection cue that survives
 *  perspective, unlike a colour change. */
function selectionRing(radius: number): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = PALETTE.confirmed;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  ctx.stroke();

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    })
  );
  sprite.scale.set(radius * 3.4, radius * 3.4, 1);
  return sprite;
}

export function buildNodeObject(n: NodeView, previous?: THREE.Object3D): THREE.Object3D {
  if (previous) disposeGroup(previous);

  const group = new THREE.Group();
  const s = sizeFor(n.degree);
  const colour = new THREE.Color(colourFor(n.type));

  const material = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.55,
    metalness: 0.1,
    transparent: true,
    emissive: colour,
  });

  if (n.dimmed) {
    // Dim-the-rest: the highlighted path keeps full opacity, everything else
    // drops away. This is how a four-hop chain becomes readable in perspective.
    material.opacity = 0.15;
    material.emissiveIntensity = 0;
  } else if (n.proposed) {
    material.opacity = 0.6;
    material.emissive = new THREE.Color(PALETTE.proposed);
    material.emissiveIntensity = 1.2;
    material.wireframe = false;
    pulsing.add(material);
  } else {
    material.opacity = 1;
    material.emissiveIntensity = 0.12;
  }

  const mesh = new THREE.Mesh(geometryFor(n.type, s), material);
  if (n.type === "document") mesh.renderOrder = 1;
  group.add(mesh);

  if (n.proposed && !n.dimmed) {
    // A wireframe cage over the solid body: the node reads as sketched rather
    // than built. Cheaper and clearer than an outline pass.
    const cage = new THREE.Mesh(
      geometryFor(n.type, s * 1.08),
      new THREE.MeshBasicMaterial({
        color: PALETTE.proposed,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      })
    );
    group.add(cage);
  }

  if (n.selected && !n.dimmed) {
    group.scale.setScalar(1.15);
    group.add(selectionRing(s));
  }

  // The label rule. Anything permanently labelled has to have earned it:
  // the analyst pointed at it, the agent proposed it, or it is one of the few
  // hubs that give the cluster its shape.
  const showLabel = !n.dimmed && (n.selected || n.hovered || n.proposed || n.isHub);
  if (showLabel) {
    const sprite = labelSprite(
      n.label.length > 34 ? n.label.slice(0, 32) + "…" : n.label,
      n.proposed ? PALETTE.proposed : PALETTE.confirmed
    );
    sprite.position.set(0, s * 1.5 + LABEL_HEIGHT * 0.5, 0);
    group.add(sprite);
  }

  return group;
}
