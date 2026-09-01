import { useWebMcpStatus } from "./status";
import { ALL_TOOLS } from "./tools";

/**
 * The WebMCP indicator in the top bar.
 *
 * Three things can be true, and conflating any two of them is what confused us:
 *
 *   off        no host on the page at all, an ordinary browser
 *   registered a host took the tools, but nothing has ever called one
 *   connected  an agent has actually used a tool this session
 *
 * The middle state is the one that matters. Chrome with the WebMCP testing flag
 * exposes navigator.modelContext to every page whether an agent is attached or
 * not, so registration succeeds in a tab with nobody on the other end. Saying
 * "live" there was true of the tools and false of the situation.
 *
 * role="status" rather than a plain span: the value changes as the agent works,
 * and a screen-reader user should hear that rather than go looking for it.
 */
export default function StatusBadge() {
  const status = useWebMcpStatus((s) => s.status);
  const inFlight = useWebMcpStatus((s) => s.inFlight);
  const callCount = useWebMcpStatus((s) => s.callCount);

  if (status.kind === "registered") {
    const toolList = ALL_TOOLS.map((t) => t.name).join("\n");

    if (inFlight > 0) {
      return (
        <span
          className="tool-badge working"
          role="status"
          title={`The agent is running ${inFlight} tool call${inFlight === 1 ? "" : "s"} right now.`}
          aria-label={`The agent is working. ${inFlight} tool calls in flight.`}
        >
          <i className="pulse" aria-hidden />
          agent working · {inFlight} call{inFlight === 1 ? "" : "s"}
        </span>
      );
    }

    if (callCount > 0) {
      return (
        <span
          className="tool-badge live"
          role="status"
          title={`Registered on ${status.where}. ${callCount} calls so far.\n\n${toolList}`}
          aria-label={`An agent is connected and has made ${callCount} tool calls.`}
        >
          agent connected · {callCount} call{callCount === 1 ? "" : "s"}
        </span>
      );
    }

    return (
      <span
        className="tool-badge idle"
        role="status"
        title={
          `All ${status.count} tools are registered on ${status.where}, but nothing has called ` +
          "one yet.\n\nA browser can expose the WebMCP host to every page whether or not an " +
          "agent is attached (Chrome does this when the testing flag is on), so this is what " +
          "you see in an ordinary tab with the flag enabled. It flips to “agent connected” " +
          `the moment something actually uses a tool.\n\n${toolList}`
        }
        aria-label={
          `${status.count} WebMCP tools are registered, but no agent has called one yet. ` +
          "The browser exposes the host whether or not an agent is attached."
        }
      >
        {status.count} tools registered · no agent yet
      </span>
    );
  }

  if (status.kind === "framed") {
    return (
      <span
        className="tool-badge off"
        role="status"
        title={
          "This page is running inside an iframe, and tools registered in a frame are never " +
          "discovered, however correctly they are registered. Open Threadweaver as a top-level page."
        }
        aria-label="WebMCP is off because this page is inside an iframe, where tools are never discovered."
      >
        WebMCP off · page is framed
      </span>
    );
  }

  if (status.kind === "absent") {
    return (
      <span
        className="tool-badge off"
        role="status"
        title={
          "No WebMCP host on this page, so no agent can see the tools.\n\n" +
          "Nothing is broken, every part of Threadweaver works without an agent. " +
          "To bring one in, open this page in ChatGPT's browser, or in Chrome 149+ with " +
          "chrome://flags/#enable-webmcp-testing enabled."
        }
        aria-label={
          "WebMCP is off: no agent host detected in this browser. The app works fully without one. " +
          "Open it in ChatGPT's browser, or Chrome 149 or later with the WebMCP testing flag."
        }
      >
        WebMCP off · no agent host
      </span>
    );
  }

  return (
    <span className="tool-badge checking" role="status" aria-label="Checking for a WebMCP host.">
      WebMCP · checking…
    </span>
  );
}
