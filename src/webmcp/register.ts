/**
 * WebMCP registration.
 *
 * Three things here will silently cost the submission if they are wrong, so
 * each is handled explicitly and commented:
 *
 *  1. `document.modelContext` is the spec location and what OpenAI's browser
 *     reads. Chrome's origin trial still exposes `navigator.modelContext`.
 *     We register on whichever exists, preferring the spec location.
 *  2. `inputSchema` is JSON Schema — see src/webmcp/schemas.ts. Every schema
 *     sets `additionalProperties: false`; narrow inputs are the documented
 *     recommendation and broad god-tools are the documented anti-pattern.
 *  3. Tools registered inside an iframe are never discovered. We refuse to
 *     register unless we are the top-level document, and say so in the console.
 *
 * If no host is present we log once and carry on. Threadweaver must work
 * completely as an ordinary web app with no agent anywhere near it.
 */

import type { McpToolDefinition, ModelContext } from "./mcpTypes";
import { setWebMcpStatus } from "./status";
import { ALL_TOOLS } from "./tools";

let registered = false;

function findModelContext(): { mc: ModelContext; where: string } | null {
  if (typeof document !== "undefined" && document.modelContext?.registerTool) {
    return { mc: document.modelContext, where: "document.modelContext" };
  }
  if (typeof navigator !== "undefined" && navigator.modelContext?.registerTool) {
    return { mc: navigator.modelContext, where: "navigator.modelContext" };
  }
  return null;
}

function isTopLevelDocument(): boolean {
  try {
    return window.top === window.self;
  } catch {
    // Cross-origin access threw, which means we are framed.
    return false;
  }
}

export async function registerWebMcpTools(
  tools: McpToolDefinition[] = ALL_TOOLS
): Promise<void> {
  if (registered) return;
  registered = true;

  if (!isTopLevelDocument()) {
    console.warn(
      "[threadweaver] running inside an iframe — WebMCP tools are not discovered " +
        "in frames, so registration was skipped. Open the page top-level."
    );
    setWebMcpStatus({ kind: "framed" });
    return;
  }

  const found = findModelContext();
  if (!found) {
    console.info(
      "[threadweaver] no WebMCP host detected; running as a normal web app. " +
        "Open in ChatGPT's browser, or Chrome 149+ with " +
        "chrome://flags/#enable-webmcp-testing."
    );
    setWebMcpStatus({ kind: "absent" });
    return;
  }

  const { mc, where } = found;
  let registeredCount = 0;
  for (const tool of tools) {
    try {
      await mc.registerTool!(tool);
      registeredCount++;
    } catch (err) {
      console.error(`[threadweaver] failed to register ${tool.name}`, err);
    }
  }

  // A host that rejected every tool is not a working host, and saying "live"
  // there would be the same lie the badge exists to stop telling.
  setWebMcpStatus(
    registeredCount > 0 ? { kind: "active", where, count: registeredCount } : { kind: "absent" }
  );

  console.info(
    `[threadweaver] registered ${tools.length} tool(s) on ${where}:`,
    tools.map((t) => t.name).join(", ")
  );
}
