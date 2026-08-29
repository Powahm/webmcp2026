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

/** Far enough back to frame the whole set, with a floor so a single node
 *  doesn't put the camera inside it. */
export function framingDistance(points: Vec3[], c: Vec3): number {
  const radius = points.reduce((max, p) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    return Math.max(max, d);
  }, 0);
  return Math.max(120, radius * 2.4 + 90);
}

export const focusTransitionMs = (): number => (prefersReducedMotion() ? 0 : FOCUS_TRANSITION_MS);
