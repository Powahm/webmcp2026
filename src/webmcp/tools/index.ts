/**
 * The registry.
 *
 * Read tools first, so they read first in the browser's Site tools panel: an
 * agent scanning the list should see what it can look at before what it can
 * assert.
 *
 * There is no commit tool, and nothing under src/webmcp/ imports
 * acceptProposal or rejectProposal. That absence is the safety guarantee, and
 * scripts/check-no-commit-tool.ts fails the build if it ever stops being true.
 */

import { instrument } from "../instrument";
import type { McpToolDefinition } from "../mcpTypes";
import { getPageTitle } from "./getPageTitle";
import { READ_TOOLS } from "./readTools";
import { WRITE_TOOLS } from "./writeTools";

export const ALL_TOOLS: McpToolDefinition[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  getPageTitle,
].map(instrument);
