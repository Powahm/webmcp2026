/**
 * The registry. Read tools first so they read first in the Site tools panel.
 *
 * Step 1 of the build order (docs/PLAN.md §5) is deliberately ONE tool: nothing
 * else is built until a judge's browser can see a tool on the deployed URL.
 */

import type { McpToolDefinition } from "../mcpTypes";
import { getPageTitle } from "./getPageTitle";

export const ALL_TOOLS: McpToolDefinition[] = [getPageTitle];
