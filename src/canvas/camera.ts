import { prefersReducedMotion } from "./palette";

/**
 * Camera behaviour. Two rules:
 *  - the camera never moves on its own while the analyst is working;
 *  - when the agent calls focus(), it moves visibly, so the analyst can see
 *    where the answer landed rather than hunting for it.
 */

export const FOCUS_TRANSITION_MS = 900;
/** Ambient motion makes a static screenshot look alive; anything faster makes
 *  the canvas hard to actually work in. */
export const AUTO_ROTATE_DEG_PER_S = 0.3;
export const IDLE_BEFORE_ROTATE_MS = 20_000;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function centroid(points: Vec3[]): Vec3 {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  const sum = points.reduce(
    (a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }),
    { x: 0, y: 0, z: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length, z: sum.z / points.length };
}

/**
 * Far enough back to frame the whole set — and generously so.
 *
 * A proposal sits at link distance 90 from its anchor and contracts to 40 when
 * accepted, so a focus computed tightly around the two of them puts the camera
 * inside the cluster the moment the accept animation runs. The floor and the
 * constant term are what keep the re-settle watchable rather than claustrophobic.
 */
export function framingDistance(points: Vec3[], c: Vec3): number {
  const radius = points.reduce((max, p) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    return Math.max(max, d);
  }, 0);
  return Math.max(220, radius * 2.8 + 170);
}

export const focusTransitionMs = (): number => (prefersReducedMotion() ? 0 : FOCUS_TRANSITION_MS);

export interface CameraLike {
  position: { x: number; y: number; z: number };
}

/**
 * Where to put the camera so that `points` are framed.
 *
 * It keeps the current viewing direction and only changes how far away the
 * camera is and what it is centred on — a fly-to should reframe, not spin the
 * analyst's world around.
 *
 * The naive version placed the camera along the vector from the world origin to
 * the centroid. That collapses when the centroid is near the origin, which is
 * exactly where a freshly proposed node sits before the simulation has given it
 * a position: the camera ends up at the origin looking at the origin, and the
 * screen goes black. Hence the fallback direction and the length guard.
 */
export function framePosition(
  camera: CameraLike,
  points: Vec3[]
): { position: Vec3; lookAt: Vec3 } | null {
  if (!points.length) return null;
  const c = centroid(points);
  const dist = framingDistance(points, c);

  let dx = camera.position.x - c.x;
  let dy = camera.position.y - c.y;
  let dz = camera.position.z - c.z;
  let len = Math.hypot(dx, dy, dz);

  if (!Number.isFinite(len) || len < 1) {
    // The camera is effectively on top of the target. Back off along a fixed
    // axis rather than dividing by nothing.
    dx = 0;
    dy = 0.35;
    dz = 1;
    len = Math.hypot(dx, dy, dz);
  }

  return {
    position: { x: c.x + (dx / len) * dist, y: c.y + (dy / len) * dist, z: c.z + (dz / len) * dist },
    lookAt: c,
  };
}

/** Nodes the simulation has actually placed. A node created this frame has no
 *  coordinates yet, and treating it as the origin is what caused the black
 *  screen described above. */
export function placedPoints<T extends { x?: number; y?: number; z?: number }>(
  nodes: T[]
): Vec3[] {
  return nodes
    .filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z))
    .map((n) => ({ x: n.x!, y: n.y!, z: n.z! }));
}
