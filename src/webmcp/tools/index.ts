/**
 * The registry.
 *
 * Read tools first, so they read first in the browser's Site tools panel: an
 * agent scanning the list should see what it can look at before what it can
 * assert. The reader tools lead, because what the analyst is reading and what
 * they marked is where an answer should start.
 *
 * There is no commit tool, and nothing under src/webmcp/ imports
 * acceptProposal or rejectProposal. That absence is the safety guarantee, and
 * scripts/check-no-commit-tool.ts fails the build if it ever stops being true.
 */

import { instrument } from "../instrument";
import type { McpToolDefinition } from "../mcpTypes";
import { getPageTitle } from "./getPageTitle";
import { READ_TOOLS } from "./readTools";
import { READER_TOOLS } from "./readerTools";
import { WRITE_TOOLS } from "./writeTools";

export const ALL_TOOLS: McpToolDefinition[] = [
  // Reader tools first. They are the ones an agent should reach for, and the
  // order a Site tools panel lists them in is the order a model scans them.
  ...READER_TOOLS,
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  getPageTitle,
].map(instrument);
