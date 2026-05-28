import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Segment } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_segments";
const TOOL_DESCRIPTION =
  "List segment definitions from the Adobe Experience Platform Unified Profile Service. " +
  "Returns a paginated list of segments, optionally filtered by state (ACTIVE/INACTIVE/DRAFT) " +
  "or by a case-insensitive name substring match (filtered client-side after the API call).";

const inputSchema = {
  ...paginationSchema,
  state: z
    .enum(["ACTIVE", "INACTIVE", "DRAFT"])
    .optional()
    .describe("Optional segment state filter"),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Optional case-insensitive substring match on segment name"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, state, name } = args;

    try {
      logger.debug({ tool: TOOL_NAME, limit, offset, state, name }, "Listing segments");

      const response = await ctx.client.request<AepListResponse<Segment>>({
        method: "GET",
        path: "/data/core/ups/segment/definitions",
        query: {
          start: offset,
          limit,
          ...(state ? { property: `state==${state}` } : {}),
        },
      });

      let allResults =
        response.results ?? response.children ?? response._embedded?.results ?? [];

      if (name) {
        const needle = name.toLowerCase();
        allResults = allResults.filter((segment) =>
          (segment.name ?? "").toLowerCase().includes(needle),
        );
      }

      const total = response.count ?? response.total ?? allResults.length + offset;

      return toolResult(
        buildPaginatedResponse<Segment>(allResults, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list segments");
      return toolError(mapApiError(err));
    }
  });
}
