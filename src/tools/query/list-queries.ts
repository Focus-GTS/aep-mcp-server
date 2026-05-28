import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Query } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_queries";
const TOOL_DESCRIPTION =
  "List queries submitted to the Adobe Experience Platform Query Service for the active sandbox. " +
  "Supports pagination, filtering by state (QUEUED/RUNNING/SUCCESS/FAILED/CANCELED), excluding " +
  "system/hidden queries, and ordering (e.g. '-created' for newest first).";

const QUERY_STATES = ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELED"] as const;

const inputSchema = {
  ...paginationSchema,
  state: z
    .enum(QUERY_STATES)
    .optional()
    .describe("Filter by query state. Omit to list queries in all states."),
  excludeHidden: z
    .boolean()
    .default(true)
    .describe(
      "Hide system-generated queries (recommended). Set false to include hidden queries.",
    ),
  orderby: z
    .string()
    .optional()
    .describe(
      "Sort order field. Prefix with '-' for descending. Defaults to '-created' (newest first). " +
        "Examples: '-created', 'created', '-updated'.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, state, excludeHidden, orderby } = args;
    const effectiveOrderby = orderby ?? "-created";

    try {
      logger.debug(
        { tool: TOOL_NAME, limit, offset, state, excludeHidden, orderby: effectiveOrderby },
        "Listing queries",
      );

      const response = await ctx.client.request<AepListResponse<Query>>({
        method: "GET",
        path: "/data/foundation/query/queries",
        query: {
          limit,
          start: offset,
          property: state ? `state==${state}` : undefined,
          excludeHidden,
          orderby: effectiveOrderby,
        },
      });

      const allResults =
        response.results ?? response.children ?? response._embedded?.results ?? [];

      const total = response.count ?? response.total ?? allResults.length + offset;

      return toolResult(
        buildPaginatedResponse<Query>(allResults, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list queries");
      return toolError(mapApiError(err));
    }
  });
}
