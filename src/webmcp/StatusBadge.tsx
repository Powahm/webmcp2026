import { useWebMcpStatus } from "./status";
import { ALL_TOOLS } from "./tools";

/**
 * The WebMCP indicator in the top bar.
 *
 * role="status" rather than a plain span: the value changes once, shortly after
 * load, and a screen-reader user should hear it rather than have to go looking.
 */
export default function StatusBadge() {
  const status = useWebMcpStatus((s) => s.status);

  if (status.kind === "active") {
    return (
      <span
        className="tool-badge live"
        role="status"
        title={`Registered on ${status.where}\n\n${ALL_TOOLS.map((t) => t.name).join("\n")}`}
        aria-label={`WebMCP is live. ${status.count} tools registered on ${status.where}.`}
      >
        {status.count} WebMCP tools · live
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
          "discovered — however correctly they are registered. Open Threadweaver as a top-level page."
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
          "Nothing is broken — every part of Threadweaver works without an agent. " +
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
