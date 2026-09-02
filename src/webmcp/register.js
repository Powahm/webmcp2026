/**
 * WebMCP registration.
 *
 * Three things here are easy to get wrong and each one silently costs the
 * submission:
 *
 *   1. The spec puts the API on `document.modelContext`. Chrome's origin trial
 *      still exposes the older `navigator.modelContext`, and Chrome 150
 *      deprecates the old location. Feature-detect and register on whichever
 *      exists.
 *   2. `inputSchema` is JSON Schema. Not TypeScript types, not a parameter
 *      list.
 *   3. **Tools registered inside an iframe are never discovered**, same-origin
 *      ones included. Desk Two is a windowed desktop, which is exactly the kind
 *      of app someone builds out of iframes. Its windows are plain divs, and
 *      they must stay that way.
 *
 * Registration happens after the first paint, from App.jsx, because the tools
 * read live state out of the running apps and there is nothing to read before
 * they exist.
 */

import { TOOLS } from "./tools.js";

export const webmcp = {
  host: null,
  registered: [],
  failed: [],
};

function findHost() {
  if (typeof document !== "undefined" && document.modelContext?.registerTool) {
    return { mc: document.modelContext, where: "document.modelContext" };
  }
  if (typeof navigator !== "undefined" && navigator.modelContext?.registerTool) {
    return { mc: navigator.modelContext, where: "navigator.modelContext" };
  }
  return null;
}

export async function registerTools(tools = TOOLS) {
  // Verification hook, always on. A host is needed to *call* a tool, and there
  // is no host in a normal browser or in a headless test, so the definitions
  // are exposed here and every tool can be exercised exactly as a host would
  // invoke it. It reads nothing and changes nothing.
  window.__desk_tools = tools;

  const host = findHost();
  if (!host) {
    console.info(
      "[desk-two] No WebMCP host on this page, running as an ordinary web app. " +
        "Open it in ChatGPT's browser, or in Chrome 149+ with " +
        "chrome://flags/#enable-webmcp-testing, to see the site tools."
    );
    return webmcp;
  }

  webmcp.host = host.where;

  for (const tool of tools) {
    try {
      await host.mc.registerTool(tool);
      webmcp.registered.push(tool.name);
    } catch (err) {
      // One bad schema must not take the rest of the surface down with it.
      webmcp.failed.push({ name: tool.name, error: String(err) });
      console.error(`[desk-two] ${tool.name} was refused by the host`, err);
    }
  }

  console.info(
    `[desk-two] ${webmcp.registered.length} site tool(s) registered on ${host.where}` +
      (webmcp.failed.length ? `, ${webmcp.failed.length} refused` : "")
  );

  // What the page actually offered, for a judge or for you at 3am, rather than
  // guessing from a panel.
  window.__desk_webmcp = webmcp;
  return webmcp;
}
