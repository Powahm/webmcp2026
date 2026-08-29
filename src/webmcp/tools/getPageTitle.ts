import { jsonResult, type McpToolDefinition } from "../mcpTypes";

/**
 * The smoke-test tool. Its only job is to prove, on the deployed URL, that
 * registration reaches ChatGPT's browser Site tools panel before any real
 * feature is built.
 */
export const getPageTitle: McpToolDefinition = {
  name: "get_page_title",
  description:
    "Return the title of the Threadweaver page and whether the corpus has finished loading. A connectivity check: if you can call this, site tools are working.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
  execute: () =>
    jsonResult({
      title: document.title,
      url: location.href,
      app: "threadweaver",
    }),
};
