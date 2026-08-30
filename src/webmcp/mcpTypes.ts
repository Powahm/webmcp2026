/**
 * Minimal typings for the WebMCP surface.
 *
 * Deliberately hand-written rather than pulled from a package: the API is still
 * moving (the spec puts it on `document.modelContext`; Chrome's origin trial
 * still exposes `navigator.modelContext`) and we only touch registerTool.
 */

/** A JSON Schema object. We do not model JSON Schema in the type system — the
 *  point is that this is JSON Schema and not TypeScript types. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

export interface ToolAnnotations {
  /** Set on every read-only tool so the browser doesn't gate it behind a prompt. */
  readOnlyHint?: boolean;
}

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  execute: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>;
}

export interface ModelContext {
  registerTool?: (tool: McpToolDefinition) => void | Promise<void>;
  provideContext?: (ctx: { tools: McpToolDefinition[] }) => void | Promise<void>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

/** Convenience: build the `{ content: [...] }` envelope from a JSON payload. */
export function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

/** An error the agent can act on. Always says what to do differently. */
export function errorResult(error: string, hint?: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error, hint }, null, 2) }],
    isError: true,
  };
}
