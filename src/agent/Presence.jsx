import { useEffect } from "react";
import { getSnapshot, subscribe } from "../webmcp/status.js";

/**
 * The page, while an agent is working in it.
 *
 * WebMCP moves a page with nothing on screen to say so, and the consuming
 * agent draws its own cursor, so a second painted one was two pointers
 * chasing each other. What the page can say that the agent's cursor cannot is
 * *the page itself is being worked on right now*, and it says it by lighting
 * its own edge.
 *
 * It is driven only by real calls: `inFlight` while one is running, and a
 * short tail after the last one so a burst reads as one stretch of work rather
 * than a flicker per call. Nothing here runs on a timer and nothing is
 * invented to fill a silence.
 */

/** How long the edge stays lit after the last call comes back. */
const TAIL = 1400;

export default function Presence() {
  useEffect(() => {
    let fade = 0;

    function apply() {
      const s = getSnapshot();
      const on = s.inFlight > 0;
      const root = document.body;

      if (on) {
        clearTimeout(fade);
        root.classList.add("agent-working");
        return;
      }
      // Only the tail is on a timer, and only ever to turn something off.
      clearTimeout(fade);
      fade = setTimeout(() => root.classList.remove("agent-working"), TAIL);
    }

    const off = subscribe(apply);
    apply();
    return () => {
      off();
      clearTimeout(fade);
      document.body.classList.remove("agent-working");
    };
  }, []);

  return null;
}
