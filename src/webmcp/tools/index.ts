/**
 * The registry.
 *
 * Read tools first, so they read first in the browser's Site tools panel: an
 * agent scanning the list should see what it can look at before what it can
 * assert.
 *
 * There is no commit tool, and nothing under src/webmcp/ imports
 * acceptProposal or rejectProposal. That absence is the safety guarantee.
 */

import { instrument } from "../instrument";
import type { McpToolDefinition } from "../mcpTypes";
import { getPageTitle } from "./getPageTitle";
import { READ_TOOLS } from "./readTools";

export const ALL_TOOLS: McpToolDefinition[] = [...READ_TOOLS, getPageTitle].map(instrument);
