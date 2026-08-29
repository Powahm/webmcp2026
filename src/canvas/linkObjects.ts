import * as THREE from "three";
import { PALETTE, prefersReducedMotion } from "./palette";

/**
 * Link rendering.
 *
 * A confirmed link is a solid line whose width grows with the number of filings
 * behind it. A proposed link is dashed, and the dashes move — that motion is
 * what reads as "live, being asserted" rather than "settled fact".
 *
 * react-force-graph-3d has no dashed-link prop (linkLineDash is 2D only), so
 * proposals get a real THREE.Line with a LineDashedMaterial, and the dash phase
 * is advanced by shifting the line-distance attribute each frame.
 */

const DASH_SIZE = 4;
const GAP_SIZE = 4;
const DASH_SPEED = 14; // world units per second

const dashedLines = new Set<THREE.Line>();

export function makeProposedLink(): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  geometry.setAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(2), 1));

  const material = new THREE.LineDashedMaterial({
    color: PALETTE.proposed,
    dashSize: DASH_SIZE,
    gapSize: GAP_SIZE,
    transparent: true,
    opacity: 0.95,
    linewidth: 1,
  });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  (line.userData as { length: number }).length = 0;
  dashedLines.add(line);
  return line;
}

export function releaseProposedLink(line: THREE.Line): void {
  dashedLines.delete(line);
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

/** Called from linkPositionUpdate — the simulation moved the endpoints. */
export function updateProposedLink(
  line: THREE.Line,
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number }
): void {
  const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  pos.setXYZ(0, start.x, start.y, start.z);
  pos.setXYZ(1, end.x, end.y, end.z);
  pos.needsUpdate = true;
  (line.userData as { length: number }).length = Math.hypot(
    end.x - start.x,
    end.y - start.y,
    end.z - start.z
  );
  line.geometry.computeBoundingSphere();
}

/**
 * Advance the dash phase. THREE.LineDashedMaterial has no dashOffset, so the
 * phase is applied by starting the line's distance accumulator part-way through
 * a dash cycle instead.
 */
export function tickDashes(timeMs: number): void {
  const period = DASH_SIZE + GAP_SIZE;
  const phase = prefersReducedMotion() ? 0 : (-(timeMs / 1000) * DASH_SPEED) % period;
  for (const line of dashedLines) {
    const dist = line.geometry.getAttribute("lineDistance") as THREE.BufferAttribute | undefined;
    if (!dist) continue;
    const len = (line.userData as { length: number }).length ?? 0;
    dist.setX(0, phase);
    dist.setX(1, phase + len);
    dist.needsUpdate = true;
  }
}

export const linkColour = (proposed: boolean, analystAsserted?: boolean): string =>
  proposed ? PALETTE.proposed : analystAsserted ? PALETTE.linkAsserted : PALETTE.link;

/** Width by evidence count: a relationship backed by three filings looks
 *  heavier than one backed by a single line in a single document. */
export const linkWidthFor = (proposed: boolean, evidenceCount: number): number =>
  proposed ? 0.7 : Math.min(2.6, 0.6 + evidenceCount * 0.35);
