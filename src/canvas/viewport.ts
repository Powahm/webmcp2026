/**
 * Pan and zoom for the 2D canvas.
 *
 * Hand-rolled, and small enough to read in one sitting. The transform is a
 * uniform scale plus a translation. No rotation, no perspective, no camera
 * vector. That is the entire reason the view cannot break the way the 3D one
 * did: framing a node is `centre the box, pick a scale`, with no direction to
 * compute and nothing to divide by.
 */

export interface Transform {
  /** World units per screen pixel, inverted: screen = world * k + t. */
  k: number;
  tx: number;
  ty: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export const identity = (): Transform => ({ k: 1, tx: 0, ty: 0 });

export const toScreen = (t: Transform, x: number, y: number): [number, number] => [
  x * t.k + t.tx,
  y * t.k + t.ty,
];

export const toWorld = (t: Transform, sx: number, sy: number): [number, number] => [
  (sx - t.tx) / t.k,
  (sy - t.ty) / t.k,
];

export const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Zoom about a screen point, so the world under the cursor stays under it. */
export function zoomAbout(t: Transform, sx: number, sy: number, factor: number): Transform {
  const k = clampZoom(t.k * factor);
  if (k === t.k) return t;
  const [wx, wy] = toWorld(t, sx, sy);
  return { k, tx: sx - wx * k, ty: sy - wy * k };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Frame a world-space box in a viewport of the given size.
 *
 * A box of zero extent. One node, or several stacked at the same point before
 * the simulation has separated them. Is the case that broke the 3D camera.
 * Here it simply produces a scale of `maxZoom` around a valid centre, because
 * the width and height are floored before they are divided by.
 */
export function frame(
  box: Box,
  width: number,
  height: number,
  padding = 90,
  maxZoom = 1.6
): Transform {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;

  const w = Math.max(1, box.x1 - box.x0);
  const h = Math.max(1, box.y1 - box.y0);
  const availW = Math.max(1, width - padding * 2);
  const availH = Math.max(1, height - padding * 2);

  const k = clampZoom(Math.min(maxZoom, Math.min(availW / w, availH / h)));
  return { k, tx: width / 2 - cx * k, ty: height / 2 - cy * k };
}

export const lerpTransform = (a: Transform, b: Transform, t: number): Transform => ({
  k: a.k + (b.k - a.k) * t,
  tx: a.tx + (b.tx - a.tx) * t,
  ty: a.ty + (b.ty - a.ty) * t,
});

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
