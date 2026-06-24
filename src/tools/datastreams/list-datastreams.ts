import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Datastream } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_datastreams";
const TOOL_DESCRIPTION =
  "List Adobe Experience Platform Edge Network datastreams for the current sandbox. " +
  "Datastreams route incoming events from the Web SDK, Mobile SDK, and Server SDK to " +
  "downstream Adobe services (AJO, Target, Analytics, AEP, Audience Manager). " +
  "Returns a paginated list of datastreams with their IDs, names, and configuration metadata.";

const inputSchema = {
  ...paginationSchema,
};

interface DatastreamListResponse {
  data?: Datastream[];
  _page?: {
    count?: number;
    total?: number;
    limit?: number;
    start?: number;
  };
  _links?: Record<string, unknown>;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Datastreams",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, offset } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, limit, offset },
          "Listing datastreams",
        );

        const response = await ctx.client.request<
          DatastreamListResponse | Datastream[]
        >({
          method: "GET",
          path: "/data/core/edge/datastreams",
          query: {
            start: offset,
            limit,
          },
        });

        // Adobe's Data Collection API sometimes returns { data: [...] } and
        // sometimes returns a bare array. Handle both shapes.
        const allResults: Datastream[] = Array.isArray(response)
          ? response
          : (response.data ?? []);

        const total = Array.isArray(response)
          ? allResults.length + offset
          : (response._page?.total ?? allResults.length + offset);

        logger.info(
          { tool: TOOL_NAME, count: allResults.length, total },
          "Datastreams listed",
        );

        return toolResult(
          buildPaginatedResponse<Datastream>(allResults, total, {
            limit,
            offset,
          }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list datastreams",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
