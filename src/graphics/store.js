import { validate } from "./spec.js";

/**
 * Graphics on the cut.
 *
 * One array, not two. A proposal and an accepted graphic are the same object
 * with a different `status`, which means one renderer draws both, one panel
 * lists both, and accepting is a field change rather than a move between
 * stores. The parallel-store version of this is twice the code and twice the
 * places for the two copies to disagree.
 *
 * There is no tool that accepts. `accept` and `reject` refuse without a trusted
 * user event, the same guard a browser uses to tell a click from a script, so
 * the agent physically cannot promote its own proposal.
 */

let graphics = [];
let counter = 0;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

export const onGraphics = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const allGraphics = () => graphics.slice();
export const liveGraphics = () => graphics.filter((g) => g.status !== "rejected");
export const acceptedGraphics = () => graphics.filter((g) => g.status === "accepted");
export const pendingGraphics = () => graphics.filter((g) => g.status === "proposed");

const trusted = (gesture) =>
  gesture?.isTrusted === true || gesture?.nativeEvent?.isTrusted === true;

/** Stage a graphic. Always `proposed`, whoever asked for it. */
export function proposeGraphic(input, context = {}) {
  const checked = validate(input, context);
  if (!checked.ok) return checked;

  const graphic = {
    id: `gfx-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    ...checked.graphic,
    status: "proposed",
    reason: String(input.reason ?? "").trim().slice(0, 200) || null,
    origin: input.origin === "human" ? "human" : "agent",
    created: Date.now(),
  };
  graphics = [...graphics, graphic];
  emit();
  return { ok: true, graphic };
}

/** Stage a change to a graphic that already exists. The original stays put
 *  until the change is accepted, so rejecting leaves the cut as it was. */
export function proposeChange(id, patch, context = {}) {
  const target = graphics.find((g) => g.id === id);
  if (!target) {
    return { ok: false, error: `No graphic with id "${id}".`, hint: "Call get_graphics for the ids on this cut." };
  }
  const merged = { ...target, ...patch, type: target.type };
  const checked = validate(merged, context);
  if (!checked.ok) return checked;

  const proposal = {
    ...target,
    ...checked.graphic,
    id: `gfx-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    status: "proposed",
    replaces: id,
    reason: String(patch.reason ?? "").trim().slice(0, 200) || null,
    origin: "agent",
    created: Date.now(),
  };
  graphics = [...graphics, proposal];
  emit();
  return { ok: true, graphic: proposal };
}

export function accept(id, gesture) {
  if (!trusted(gesture)) {
    return { ok: false, error: "Only the person at the keyboard can accept a graphic." };
  }
  const target = graphics.find((g) => g.id === id);
  if (!target || target.status !== "proposed") return { ok: false, error: "No pending graphic with that id." };

  graphics = graphics
    // A change supersedes what it replaces, rather than sitting on top of it.
    .filter((g) => g.id !== target.replaces)
    .map((g) => (g.id === id ? { ...g, status: "accepted", replaces: undefined } : g));
  emit();
  return { ok: true };
}

export function reject(id, gesture) {
  if (!trusted(gesture)) return { ok: false, error: "Only the person at the keyboard can reject a graphic." };
  graphics = graphics.filter((g) => g.id !== id);
  emit();
  return { ok: true };
}

export function removeGraphic(id, gesture) {
  if (!trusted(gesture)) return { ok: false, error: "Only the person at the keyboard can delete a graphic." };
  graphics = graphics.filter((g) => g.id !== id);
  emit();
  return { ok: true };
}

export function clearGraphics() {
  graphics = [];
  emit();
}
