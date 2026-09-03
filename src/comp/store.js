/**
 * The composition, and the one rule about changing it.
 *
 * Layers and audio tracks live in one array each, and a proposal is the same
 * object as an accepted layer with a different `status`. That is the same
 * bargain graphics/store.js already makes and it pays the same way: one
 * renderer draws both, one panel lists both, and accepting is a field change
 * rather than a move between two stores that can disagree.
 *
 * **Nothing here can be accepted by an agent.** `accept` and its siblings
 * refuse without a trusted user event: the same bit a browser uses to tell a
 * real click from a synthetic one. So the agent can compose an eight-second
 * animated title card, a sound effect under it and a reframe to vertical in
 * three calls, and it still cannot put one frame of any of it into the video.
 * There is no tool that accepts, and this is the guard that makes that true
 * rather than merely stated.
 */

import { emptyComposition, validateAudio, validateFormat, validateLayer } from "./composition.js";
import { durationOf, resolve } from "./engine.js";

let doc = emptyComposition();
let counter = 0;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

export const onComposition = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/* ------------------------------------------------------------------ reading */

export const composition = () => doc;

const notRejected = (x) => x.status !== "rejected";

/**
 * Scrolled out of its own clip.
 *
 * An element that belongs to a motion graphics clip and has been pushed
 * outside that clip's window -- by trimming the clip's head, or by shortening
 * its tail -- is not deleted, it is parked. It keeps its frame, so widening
 * the clip again brings it back exactly where it was, and every reader below
 * skips it, so it cannot draw over the clip next door. That leak is the whole
 * reason this flag exists: absolute position used to be the only thing saying
 * which clip an element was in, so shortening one handed its contents to its
 * neighbour.
 */
const onScreen = (x) => x.clipped !== true;
const live = (x) => notRejected(x) && onScreen(x);

export const liveLayers = () => doc.layers.filter(live);
export const acceptedLayers = () => doc.layers.filter((l) => l.status === "accepted" && onScreen(l));
export const pendingLayers = () => doc.layers.filter((l) => l.status === "proposed" && onScreen(l));

export const liveAudio = () => doc.audio.filter(live);
export const acceptedAudio = () => doc.audio.filter((a) => a.status === "accepted" && onScreen(a));
export const pendingAudio = () => doc.audio.filter((a) => a.status === "proposed" && onScreen(a));

/** Everything waiting on a decision, layers and audio and the format, so the
 *  tab can badge a single number. */
export const pendingCount = () =>
  pendingLayers().length + pendingAudio().length + (doc.pendingFormat ? 1 : 0);

/** How long the graphics run, in frames. The cut's own length is the editor's
 *  business; this is only what is layered over it. */
export const layerFrames = () => durationOf(resolve(liveLayers()));

const id = (prefix) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * The gesture guard.
 *
 * `isTrusted` is false on any event a script dispatched, so this is the same
 * question the browser asks before it will open a file picker. React wraps
 * native events, hence the second branch.
 */
const trusted = (gesture) =>
  gesture?.isTrusted === true || gesture?.nativeEvent?.isTrusted === true;

const denied = (what) => ({
  ok: false,
  error: `Only the person at the keyboard can ${what}.`,
});

/* ----------------------------------------------------------------- staging */

/** Stage a layer. Always `proposed`, whoever asked for it. */
export function proposeLayer(input, context = {}) {
  const checked = validateLayer(input, context);
  if (!checked.ok) return checked;

  const layer = {
    id: id("layer"),
    ...checked.layer,
    status: "proposed",
    reason: String(input.reason ?? "").trim().slice(0, 200) || null,
    origin: input.origin === "human" ? "human" : "agent",
    created: Date.now(),
  };
  doc = { ...doc, layers: [...doc.layers, layer] };
  emit();
  return { ok: true, layer };
}

/** Stage a change to a layer that is already there. The original stays exactly
 *  as it is until the change is accepted, so rejecting costs nothing. */
export function proposeLayerChange(targetId, patch, context = {}) {
  const target = doc.layers.find((l) => l.id === targetId);
  if (!target) {
    return {
      ok: false,
      error: `No layer with id "${targetId}".`,
      hint: "Call get_composition for the ids on this cut.",
    };
  }

  // Merge before validating, so a patch of one field is checked against the
  // whole layer rather than on its own. Sending only `duration_seconds` for a
  // bullet list must not fail for want of items it already has.
  const merged = {
    component: target.component,
    at_seconds: patch.at_seconds ?? target.from / doc.fps,
    duration_seconds: patch.duration_seconds ?? target.durationInFrames / doc.fps,
    position: patch.position ?? target.position,
    palette_role: patch.palette_role ?? target.palette_role,
    easing: patch.easing ?? target.easing,
    ...target.props,
    ...Object.fromEntries(
      ["text", "subtext", "eyebrow", "items", "timings", "point"]
        .filter((k) => patch[k] !== undefined)
        .map((k) => [k, patch[k]])
    ),
  };

  const checked = validateLayer(merged, context);
  if (!checked.ok) return checked;

  const proposal = {
    ...target,
    ...checked.layer,
    id: id("layer"),
    status: "proposed",
    replaces: targetId,
    reason: String(patch.reason ?? "").trim().slice(0, 200) || null,
    origin: "agent",
    created: Date.now(),
  };
  doc = { ...doc, layers: [...doc.layers, proposal] };
  emit();
  return { ok: true, layer: proposal };
}

export function proposeAudio(input, context = {}) {
  const checked = validateAudio(input, context);
  if (!checked.ok) return checked;

  const track = {
    id: id("aud"),
    ...checked.track,
    status: "proposed",
    reason: String(input.reason ?? "").trim().slice(0, 200) || null,
    origin: input.origin === "human" ? "human" : "agent",
    created: Date.now(),
  };
  doc = { ...doc, audio: [...doc.audio, track] };
  emit();
  return { ok: true, track };
}

/**
 * Stage a reframe.
 *
 * One at a time, and it replaces any reframe already waiting: two pending
 * formats is a question with no answer, and the agent asking for vertical
 * twice should not need two rejections.
 */
export function proposeFormat(name, { reason } = {}) {
  const checked = validateFormat(name);
  if (!checked.ok) return checked;
  if (checked.format === doc.format) {
    return {
      ok: false,
      error: `The composition is already ${checked.format}.`,
      hint: "Call get_composition to see the current format before proposing one.",
    };
  }
  doc = {
    ...doc,
    pendingFormat: {
      format: checked.format,
      reason: String(reason ?? "").trim().slice(0, 200) || null,
      created: Date.now(),
    },
  };
  emit();
  return { ok: true, format: checked.format };
}

/* ---------------------------------------------------------------- deciding */

export function acceptLayer(layerId, gesture) {
  if (!trusted(gesture)) return denied("accept a layer");
  const target = doc.layers.find((l) => l.id === layerId);
  if (!target || target.status !== "proposed") {
    return { ok: false, error: "No pending layer with that id." };
  }
  doc = {
    ...doc,
    layers: doc.layers
      // A change supersedes what it replaces rather than stacking on top of it.
      .filter((l) => l.id !== target.replaces)
      .map((l) => (l.id === layerId ? { ...l, status: "accepted", replaces: undefined } : l)),
  };
  emit();
  return { ok: true };
}

export function rejectLayer(layerId, gesture) {
  if (!trusted(gesture)) return denied("reject a layer");
  doc = { ...doc, layers: doc.layers.filter((l) => l.id !== layerId) };
  emit();
  return { ok: true };
}

export function acceptAudio(trackId, gesture) {
  if (!trusted(gesture)) return denied("accept a sound");
  const target = doc.audio.find((a) => a.id === trackId);
  if (!target || target.status !== "proposed") {
    return { ok: false, error: "No pending sound with that id." };
  }
  doc = {
    ...doc,
    audio: doc.audio.map((a) => (a.id === trackId ? { ...a, status: "accepted" } : a)),
  };
  emit();
  return { ok: true };
}

export function rejectAudio(trackId, gesture) {
  if (!trusted(gesture)) return denied("reject a sound");
  doc = { ...doc, audio: doc.audio.filter((a) => a.id !== trackId) };
  emit();
  return { ok: true };
}

export function acceptFormat(gesture) {
  if (!trusted(gesture)) return denied("change the format");
  if (!doc.pendingFormat) return { ok: false, error: "No reframe is waiting." };
  doc = { ...doc, format: doc.pendingFormat.format, pendingFormat: null };
  emit();
  return { ok: true };
}

export function rejectFormat(gesture) {
  if (!trusted(gesture)) return denied("reject the format");
  doc = { ...doc, pendingFormat: null };
  emit();
  return { ok: true };
}

/** The editor's own controls. A person may set the format directly; that is
 *  what being the person at the keyboard means. */
export function setFormat(name, gesture) {
  if (!trusted(gesture)) return denied("change the format");
  const checked = validateFormat(name);
  if (!checked.ok) return checked;
  doc = { ...doc, format: checked.format, pendingFormat: null };
  emit();
  return { ok: true };
}

/**
 * Move or resize a layer by hand.
 *
 * The agent has no route to this: it proposes and the proposal waits. This is
 * the person dragging the block on the timeline, so it takes the same trusted
 * gesture every other decision here takes, and it edits the layer in place
 * rather than staging a change nobody asked to review.
 */
export function editLayer(layerId, patch, gesture) {
  if (!trusted(gesture)) return denied("move a layer");
  const target = doc.layers.find((l) => l.id === layerId);
  if (!target) return { ok: false, error: "No layer with that id." };

  const from = Math.max(0, Math.round(patch.from ?? target.from));
  const durationInFrames = Math.max(3, Math.round(patch.durationInFrames ?? target.durationInFrames));
  // A resize by hand is a new intent, so it becomes the length the element
  // wants to be. `reseat` shortens `durationInFrames` to fit a clip that is
  // currently too small; `span` is what it goes back to when there is room.
  const span = patch.durationInFrames != null ? durationInFrames : (target.span ?? durationInFrames);
  // Words and placement change in place. A component change does not: the
  // fields differ per component, so that one goes back through validateLayer
  // rather than being merged blind.
  const next = {
    ...target,
    from,
    durationInFrames,
    span,
    component: patch.component ?? target.component,
    easing: patch.easing ?? target.easing,
    position: patch.position ?? target.position,
    palette_role: patch.palette_role ?? target.palette_role,
    // A component change replaces the props outright: the fields differ per
    // component, and merging leaves the old one's fields hanging off the new.
    keys: patch.keys ?? target.keys,
    props: patch.props
      ? (patch.component && patch.component !== target.component
          ? patch.props
          : { ...target.props, ...patch.props })
      : target.props,
  };
  doc = { ...doc, layers: doc.layers.map((l) => (l.id === layerId ? next : l)) };
  emit();
  return { ok: true };
}

export function removeLayer(layerId, gesture) {
  if (!trusted(gesture)) return denied("delete a layer");
  doc = { ...doc, layers: doc.layers.filter((l) => l.id !== layerId) };
  emit();
  return { ok: true };
}

/** Move or retime a sound by hand. Same trusted gesture as everything else. */
export function editAudio(trackId, patch, gesture) {
  if (!trusted(gesture)) return denied("move a sound");
  const target = doc.audio.find((a) => a.id === trackId);
  if (!target) return { ok: false, error: "No sound with that id." };
  const from = Math.max(0, Math.round(patch.from ?? target.from));
  const durationInFrames = Math.max(2, Math.round(patch.durationInFrames ?? target.durationInFrames));
  const span = patch.durationInFrames != null ? durationInFrames : (target.span ?? durationInFrames);
  doc = {
    ...doc,
    audio: doc.audio.map((a) =>
      (a.id === trackId ? { ...a, from, durationInFrames, span, gain: patch.gain ?? a.gain } : a)),
  };
  emit();
  return { ok: true };
}

export function removeAudio(trackId, gesture) {
  if (!trusted(gesture)) return denied("delete a sound");
  doc = { ...doc, audio: doc.audio.filter((a) => a.id !== trackId) };
  emit();
  return { ok: true };
}

/**
 * Slide everything after a removal back by what was removed.
 *
 * A layer's `from` is an absolute frame of the finished cut, so cutting a
 * second out at 0:05 moves every graphic and every sound after it a second
 * earlier. Nothing else re-times them, and a title card that was placed on a
 * sentence has no value once it is sitting on the following one.
 *
 * A layer that straddles the removal keeps its start and loses the removed
 * frames from its duration, so it still covers the words it was placed over.
 */
export function shiftAfter(atFrame, removedFrames) {
  if (!(removedFrames > 0)) return;

  const move = (item) => {
    // An element inside a motion graphics clip is positioned by that clip, so
    // moving it here as well would move it twice for the same removal.
    if (item.owner) return item;
    const end = item.from + item.durationInFrames;
    if (item.from >= atFrame) {
      return { ...item, from: Math.max(0, item.from - removedFrames) };
    }
    if (end > atFrame) {
      // Straddles the cut: shorten rather than move, and never below a frame.
      const overlap = Math.min(removedFrames, end - atFrame);
      return { ...item, durationInFrames: Math.max(1, item.durationInFrames - overlap) };
    }
    return item;
  };

  doc = { ...doc, layers: doc.layers.map(move), audio: doc.audio.map(move) };
  emit();
}

/* ------------------------------------------------- motion graphics clips */

/**
 * Which clip an element is in, held as a field rather than read off the clock.
 *
 * Before this, an element belonged to whichever motion graphics clip its start
 * second happened to land in. That is fine until a clip changes length: drag
 * one clip's tail in and half its contents are suddenly sitting in the clip
 * after it, still drawing, now over somebody else's frames. Trim its head and
 * the window slid right while the contents stayed put, so the far end of the
 * animation went missing instead of the near one.
 *
 * `owner` is the fix. Membership is decided once, when an element first lands
 * in a clip, and after that the clip carries its contents around: `reseat`
 * moves them when the clip moves, shortens them to fit when it shrinks, and
 * parks the ones that no longer fit rather than letting them escape.
 */
export function adoptInside(owner, startFrame, endFrame) {
  let touched = false;
  const take = (item) => {
    if (item.owner != null || item.clipped) return item;
    if (!(item.from >= startFrame && item.from < endFrame)) return item;
    touched = true;
    return { ...item, owner, span: item.span ?? item.durationInFrames };
  };
  const layers = doc.layers.map(take);
  const audio = doc.audio.map(take);
  if (!touched) return;
  doc = { ...doc, layers, audio };
  emit();
}

/**
 * Put a clip's contents back where the clip now is.
 *
 * `shiftFrames` is how far the clip's own origin moved, so everything it owns
 * moves by the same amount and the animation keeps its shape.
 *
 * Three things can happen to an element when its clip changes length:
 *
 *   - it still fits, and nothing happens to it;
 *   - it overlaps the clip only partly, because the head was trimmed past its
 *     start or the tail past its end. It keeps its own origin and gets a
 *     `window`, so the part still inside the clip draws and the rest does
 *     not. The origin is what its animation is measured from, so a title
 *     half-scrolled off the front comes in half-animated instead of replaying
 *     its entrance against the clip's edge;
 *   - it no longer overlaps at all, and is parked. Parked, not deleted: it
 *     keeps its frame, so widening the clip brings it back exactly where it
 *     was.
 *
 * `settled` is true when the clip's geometry did not change, which means an
 * element sitting outside it was dragged out by hand rather than left behind.
 * That one is released instead of parked, or it would vanish with no way back.
 */
export function reseat(owner, { shiftFrames = 0, startFrame = 0, endFrame = 0, settled = false } = {}) {
  let touched = false;
  const seat = (item) => {
    if (item.owner !== owner) return item;
    // Not clamped to zero. Trimming a clip's head scrolls its contents off the
    // front, and an element that has gone past the start has to keep going, or
    // widening the clip again would not bring it back where it was.
    const from = item.from + shiftFrames;
    const span = Math.max(1, item.span ?? item.durationInFrames);
    const overlaps = from + span > startFrame && from < endFrame;

    const next = overlaps
      ? {
          ...item,
          from,
          span,
          clipped: false,
          // The bar on the track is the length that plays, so the tail is
          // shortened here rather than left to the window. The head is not:
          // shortening it there would move the origin and take the animation
          // with it.
          durationInFrames: Math.max(1, Math.min(span, endFrame - from)),
          window: { from: startFrame, to: endFrame },
        }
      : settled
        ? {
            ...item,
            from: Math.max(0, from),
            span,
            clipped: false,
            owner: null,
            window: null,
            durationInFrames: span,
          }
        : { ...item, from, span, clipped: true, window: { from: startFrame, to: endFrame } };

    if (next.from !== item.from
      || next.clipped !== (item.clipped === true)
      || (next.owner === null && item.owner != null)
      || next.durationInFrames !== item.durationInFrames
      || next.span !== item.span
      || next.window?.from !== item.window?.from
      || next.window?.to !== item.window?.to) touched = true;
    return next;
  };
  const layers = doc.layers.map(seat);
  const audio = doc.audio.map(seat);
  if (!touched) return;
  doc = { ...doc, layers, audio };
  emit();
}

/**
 * Put the whole composition back to a state the person was in before.
 *
 * The Editor's undo has to restore what a timeline edit took with it -- the
 * elements that went when their motion graphics clip was deleted, the frames a
 * cut shifted -- and that state lives here, not there. It takes the same
 * trusted gesture every other decision in this file takes, so undo is a
 * person's click like accepting is, and there is still no route from a tool to
 * a state the person did not click their way into.
 */
export function restoreComposition(next, gesture) {
  if (!trusted(gesture)) return denied("undo an edit");
  if (!next || !Array.isArray(next.layers) || !Array.isArray(next.audio)) {
    return { ok: false, error: "That is not a composition." };
  }
  doc = { ...emptyComposition(), ...next, layers: next.layers.slice(), audio: next.audio.slice() };
  emit();
  return { ok: true };
}

/** The clip is gone. Anything it still owns goes back to standing on its own. */
export function disown(owner) {
  let touched = false;
  const free = (item) => {
    if (item.owner !== owner) return item;
    touched = true;
    return { ...item, owner: null, clipped: false, window: null };
  };
  const layers = doc.layers.map(free);
  const audio = doc.audio.map(free);
  if (!touched) return;
  doc = { ...doc, layers, audio };
  emit();
}

export function clearComposition() {
  doc = emptyComposition();
  emit();
}
