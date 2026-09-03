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

/* ============================================================
   The permissions the app actually needs, in one place.
   ============================================================ */

/**
 * Why this is a list rather than five special cases.
 *
 * The browser has no single place that says what this page may do. The camera
 * and the microphone answer to the Permissions API; screen capture answers to
 * nothing and asks every time; a folder is not a permission at all but a
 * picker that either opens or does not; and whether the clips survive being
 * closed is a fourth thing again, under Storage. A person does not care about
 * that taxonomy. They want to know which of the things this app does are
 * switched on, so they are one list, with one shape, and each knows how to ask
 * for itself.
 *
 * Three states, not two. Green is granted. Red is refused, and the important
 * part about red is that pressing a button cannot undo it: once an origin is
 * denied the camera, the browser stops asking and starts refusing instantly,
 * so the only way back is its own site settings and the panel has to say so.
 * Amber is the honest middle: not asked yet, or something that asks every
 * time, which is most of them on a page nobody has used yet.
 */
export const PERMISSIONS = [
  {
    id: "camera",
    name: "Camera",
    what: "Recording yourself in the Camera app.",
    ask: "Allow camera",
  },
  {
    id: "microphone",
    name: "Microphone",
    what: "Sound on your takes, and the transcript that comes from them.",
    ask: "Allow microphone",
  },
  {
    id: "screen",
    name: "Screen",
    what: "Recording a window or a screen instead of yourself.",
    ask: "Test screen capture",
  },
  {
    id: "files",
    name: "Files",
    what: "Bringing a folder of footage and scripts onto the desktop.",
    ask: "Choose a folder",
  },
  {
    id: "storage",
    name: "Storage",
    what: "Keeping your clips when the browser is short of space.",
    ask: "Keep my clips",
  },
];

/**
 * Was this frame given the feature at all?
 *
 * A page inside somebody else's frame only has the camera if that page passed
 * it down, and no amount of asking will change that from in here. Where the
 * browser exposes its own answer, use it: it is the difference between a
 * permission the person can grant and one that was never on offer, which is
 * the difference between a button worth pressing and a button that lies.
 */
function policyAllows(feature) {
  try {
    const policy = document.featurePolicy || document.permissionsPolicy;
    if (!policy?.allowsFeature) return null;
    return policy.allowsFeature(feature);
  } catch {
    return null;
  }
}

const OFF = (why) => ({ state: "off", why });
const ASK = (why) => ({ state: "ask", why });
const ON = (why) => ({ state: "on", why });

async function readOne(id) {
  if (!secure() && id !== "files") {
    return OFF("This page is not on https or localhost, so the browser will not offer it.");
  }

  if (id === "camera" || id === "microphone") {
    const feature = id === "camera" ? "camera" : "microphone";
    if (!navigator.mediaDevices?.getUserMedia) {
      return OFF("This browser does not offer recording to the page at all.");
    }
    if (policyAllows(feature) === false) {
      return OFF(
        `This page is inside another page's frame, and that page did not pass the ${feature} down. Open it in a tab of its own.`
      );
    }
    const state = await permissionState(feature);
    if (state === "granted") return ON("Allowed.");
    if (state === "denied") {
      return OFF("Refused for this site. The browser will not ask again: change it in the site settings from the address bar, then press Recheck.");
    }
    // "prompt", and "unknown" where the query is not supported, are the same
    // thing to a person: nobody has been asked yet.
    return ASK("Not asked yet. Pressing the button asks.");
  }

  if (id === "screen") {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      return OFF("This browser does not offer screen capture to the page.");
    }
    if (policyAllows("display-capture") === false) {
      return OFF("This page is inside another page's frame that cannot capture a screen. Open it in a tab of its own.");
    }
    return ASK("Screen capture asks every time, and cannot be granted in advance.");
  }

  if (id === "files") {
    if (window.showDirectoryPicker && !framed()) return ON("The folder picker is available.");
    return ASK("The folder picker is not available here, so a folder is chosen through a file dialog instead. It still works.");
  }

  if (id === "storage") {
    try {
      const kept = await navigator.storage?.persisted?.();
      if (kept) return ON("Your clips are kept even when the browser is short of space.");
      return ASK("Clips are stored, but the browser may clear them if it needs the space.");
    } catch {
      return ASK("This browser does not say whether it will keep them.");
    }
  }

  return ASK("");
}

/** Every permission, with its state and a sentence about it. */
export async function readPermissions() {
  return Promise.all(
    PERMISSIONS.map(async (p) => ({ ...p, ...(await readOne(p.id)) }))
  );
}

/**
 * Ask for one of them.
 *
 * Asking is the same act as using it, for all but storage: there is no way to
 * request the camera except to open it and let go again, which is what this
 * does. Where the browser has already refused, the request fails instantly
 * rather than prompting, and saying that plainly is the only useful thing left
 * to do.
 */
export async function requestPermission(id) {
  if (id === "camera" || id === "microphone") {
    const result = await askForCameraAndMic({
      video: id === "camera",
      audio: id === "microphone",
    });
    if (result.ok) return { ok: true, message: `${id === "camera" ? "Camera" : "Microphone"} allowed.` };
    if (result.error === "NotAllowedError" || result.error === "SecurityError") {
      return {
        ok: false,
        message: framed()
          ? "The page this one is inside did not pass it down. Open Deskmate in a tab of its own."
          : "The browser refused without asking. Open the site settings from the address bar, set it to Allow, then press Recheck.",
      };
    }
    if (result.error === "NotFoundError") return { ok: false, message: "No device of that kind on this machine." };
    if (result.error === "NotReadableError") return { ok: false, message: "Another app is holding it." };
    return { ok: false, message: result.detail || "It could not be started." };
  }

  if (id === "screen") {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      return { ok: true, message: "Screen capture works here." };
    } catch (err) {
      if (err?.name === "NotAllowedError") return { ok: false, message: "Cancelled, or refused by this browser." };
      return { ok: false, message: err?.message || "Screen capture is not available here." };
    }
  }

  if (id === "files") {
    const { pickFolderOntoDesk } = await import("../folders/import.js");
    const folder = await pickFolderOntoDesk();
    return folder
      ? { ok: true, message: `${folder.name} is on your desk.` }
      : { ok: false, message: "No folder came back." };
  }

  if (id === "storage") {
    try {
      const kept = await navigator.storage?.persist?.();
      return kept
        ? { ok: true, message: "Your clips will be kept." }
        : { ok: false, message: "The browser decided not to. It usually says yes once the site has been used a few times." };
    } catch {
      return { ok: false, message: "This browser does not offer it." };
    }
  }

  return { ok: false, message: "" };
}

/**
 * Tell me when one of these changes underneath us.
 *
 * Someone who flips the camera back on in the site settings has not touched
 * this page, and a row of lights that is only right until the moment it
 * matters is worse than no lights. Only the Permissions API reports changes,
 * so the rest are re-read whenever the panel is opened.
 */
export function watchPermissions(fn) {
  const stops = [];
  for (const name of ["camera", "microphone"]) {
    navigator.permissions
      ?.query({ name })
      .then((status) => {
        const handler = () => fn();
        status.addEventListener?.("change", handler);
        stops.push(() => status.removeEventListener?.("change", handler));
      })
      .catch(() => { /* the query is not supported; the panel re-reads on open */ });
  }
  return () => stops.forEach((stop) => stop());
}
