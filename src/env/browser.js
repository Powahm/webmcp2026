/**
 * What this browser will actually let the page do.
 *
 * Deskmate is meant to be opened by an agent's browser, and an agent's browser
 * is not always an ordinary tab. It may be a panel inside another app, and a
 * page inside a frame it does not own gets a different set of powers to the
 * same page in a tab of its own: the directory picker refuses, the camera and
 * the microphone are off unless the surrounding page explicitly passed them
 * down, and none of that is anything the page itself can grant.
 *
 * The page cannot fix that, but it can stop pretending it did not happen. Every
 * feature that can be taken away this way asks here first, says which of the
 * three reasons it is, and offers the one thing that does work: the same page,
 * in a tab of its own.
 */

/**
 * Are we inside a frame belonging to someone else?
 *
 * Reading `window.top` across origins throws, and the throw is itself the
 * answer: a frame that cannot see its own top is a frame in someone else's
 * page.
 */
export function framed() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** https or localhost. Cameras, microphones and pickers need it. */
export const secure = () => window.isSecureContext !== false;

/**
 * What the browser already thinks about a permission, without asking for it.
 *
 * Returns "granted", "denied", "prompt", or "unknown" where the query itself is
 * not supported, which several browsers still do not support for the camera.
 * Never throws: this is called to write a sentence, and a sentence that throws
 * is worse than one that says it does not know.
 */
export async function permissionState(name) {
  try {
    const status = await navigator.permissions?.query({ name });
    return status?.state || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Ask for the camera and the microphone, on purpose, from a button.
 *
 * The prompt normally arrives as a side effect of opening Camera, which is the
 * worst moment for it: the person is looking at a preview that has not
 * appeared yet, and an agent's browser may dismiss a prompt nobody appears to
 * have asked for. Pressing a button that says it is about to ask is a request
 * the browser and the person can both see coming.
 *
 * The tracks are stopped the instant they arrive. The point is the grant, which
 * the browser remembers for this origin, not the stream: the recorder opens its
 * own with the constraints it actually wants.
 */
export async function askForCameraAndMic({ video = true, audio = true } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "unsupported" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    stream.getTracks().forEach((track) => track.stop());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.name || "unknown", detail: err?.message || "" };
  }
}

/**
 * The same page, in a tab of its own.
 *
 * This is the whole workaround for a frame that will not pass the camera or the
 * picker down, and it has to be called straight from a click: a window opened
 * without a gesture behind it is a popup, and popups are blocked. It can still
 * be refused, so it says whether it worked rather than assuming.
 */
export function openInOwnTab() {
  try {
    const tab = window.open(window.location.href, "_blank", "noopener");
    return Boolean(tab);
  } catch {
    return false;
  }
}

/** One line for a panel: what is on, what is off, and why. */
export async function describeEnvironment() {
  const bits = [framed() ? "in a frame" : "in its own tab", secure() ? "secure" : "not a secure page"];
  const camera = await permissionState("camera");
  const mic = await permissionState("microphone");
  if (camera !== "unknown") bits.push(`camera ${camera}`);
  if (mic !== "unknown") bits.push(`mic ${mic}`);
  if (!window.showDirectoryPicker) bits.push("no folder picker");
  return bits.join(" · ");
}
