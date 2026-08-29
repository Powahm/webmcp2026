/**
 * Force configuration — where the metaphor lives.
 *
 * A proposal is attached by a weak spring at a long distance, so it visibly
 * floats unsettled at the edge of the cluster. Accepting it tightens the spring
 * and shortens the distance, and the whole graph contracts and re-settles
 * around the new fact. You watch knowledge lock in.
 *
 * None of this is decoration: every number below is a claim about how much the
 * analyst believes something.
 */

export const FORCE = {
  charge: -120,
  chargeDistanceMax: 400,

  linkDistanceConfirmed: 40,
  linkDistanceProposed: 90,

  linkStrengthConfirmed: 1.0,
  /** The weak spring. A proposal drifts; a fact is held. */
  linkStrengthProposed: 0.15,

  /** Mild, so the working set stays on screen without being crushed together. */
  centerStrength: 0.04,
} as const;

/** ~700ms with an ease-out cubic. Do not shorten this to feel snappy — it is
 *  the thing people remember. Reduced motion collapses it to 200ms. */
export const ACCEPT_ANIMATION_MS = 700;
export const ACCEPT_ANIMATION_MS_REDUCED = 200;
export const REJECT_ANIMATION_MS = 400;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * An accepted edge does not snap from weak to strong. It animates, and the
 * simulation is reheated so the neighbourhood moves with it.
 */
export function acceptProgress(justAccepted: number | undefined, now: number, reduced: boolean): number {
  if (!justAccepted) return 1;
  const duration = reduced ? ACCEPT_ANIMATION_MS_REDUCED : ACCEPT_ANIMATION_MS;
  const t = Math.min(1, (now - justAccepted) / duration);
  return easeOutCubic(t);
}

export function linkDistanceFor(proposed: boolean, acceptT = 1): number {
  return proposed
    ? FORCE.linkDistanceProposed
    : FORCE.linkDistanceProposed +
        (FORCE.linkDistanceConfirmed - FORCE.linkDistanceProposed) * acceptT;
}

export function linkStrengthFor(proposed: boolean, acceptT = 1): number {
  return proposed
    ? FORCE.linkStrengthProposed
    : FORCE.linkStrengthProposed +
        (FORCE.linkStrengthConfirmed - FORCE.linkStrengthProposed) * acceptT;
}
