import { callEnded, callStarted } from "./status";
import { toolLog } from "../state/toolLogStore";
import { errorResult, type McpToolDefinition, type ToolResult } from "./mcpTypes";
import { corpusReady } from "../corpus/loadCorpus";

/**
 * Wraps every tool so the ToolLog panel sees the call, its arguments and how
 * long it took — that panel is the visible proof that the standard is doing the
 * work, and it is what the video shows.
 *
 * It also gives every tool one guarantee for free: a tool called before the
 * corpus has loaded answers with something the agent can act on rather than
 * throwing. Registration happens last precisely so this should not occur, but
 * a host is free to call whenever it likes.
 */

let seq = 0;

function summarise(result: ToolResult): string {
  const text = result.content[0]?.text ?? "";
  if (result.isError) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      return parsed.error ?? "error";
    } catch {
      return "error";
    }
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) return `${value.length} ${key}`;
    }
    if (typeof parsed.ok === "boolean") return parsed.ok ? "ok" : "refused";
    const first = Object.values(parsed)[0];
    return typeof first === "string" ? first.slice(0, 60) : "ok";
  } catch {
    return text.slice(0, 60);
  }
}

export function instrument(tool: McpToolDefinition): McpToolDefinition {
  return {
    ...tool,
    execute: async (args) => {
      const started = performance.now();
      // Bracketed here rather than inside the try, so the in-flight count is
      // decremented on every path including a thrown tool.
      callStarted();
      let result: ToolResult;
      try {
        if (!corpusReady()) {
          result = errorResult(
            "The corpus is still loading.",
            "Wait a moment and call again."
          );
        } else {
          result = await tool.execute(args);
        }
      } catch (err) {
        result = errorResult(
          err instanceof Error ? err.message : String(err),
          "This is a bug in the page rather than a problem with the arguments."
        );
      }

      callEnded();

      toolLog()._push({
        id: `call:${Date.now().toString(36)}-${seq++}`,
        tool: tool.name,
        args,
        summary: summarise(result),
        ok: !result.isError,
        durationMs: Math.round(performance.now() - started),
        at: Date.now(),
        readOnly: tool.annotations?.readOnlyHint === true,
      });

      return result;
    },
  };
}
