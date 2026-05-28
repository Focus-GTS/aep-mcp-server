import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Destination } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_destinations";
const TOOL_DESCRIPTION =
  "List available destination connectors from the Adobe Experience Platform Destinations catalog. " +
  "These are connection specifications (templates) for activating audiences to external systems " +
  "(advertising platforms, email/SMS, cloud storage, social, etc.). " +
  "Returns a paginated list, optionally filtered by category.";

const inputSchema = {
  ...paginationSchema,
  category: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional category filter (e.g. 'advertising', 'email', 'social', 'cloudStorage'). " +
        "Matched case-insensitively against the connector's category.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, category } = args;

    try {
      logger.debug(
        { tool: TOOL_NAME, limit, offset, category },
        "Listing destination connectors",
      );

      const response = await ctx.client.request<AepListResponse<Destination>>({
        method: "GET",
        path: "/data/foundation/flowservice/connectionSpecs",
        query: {
          property: "providerId==EXTERNAL_DESTINATION",
        },
      });

      let allResults =
        response.results ?? response.children ?? response._embedded?.results ?? [];

      if (category) {
        const needle = category.toLowerCase();
        allResults = allResults.filter(
          (destination) => (destination.category ?? "").toLowerCase() === needle,
        );
      }

      const total = response.count ?? response.total ?? allResults.length;
      const paginated = allResults.slice(offset, offset + limit);

      return toolResult(
        buildPaginatedResponse<Destination>(paginated, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list destination connectors");
      return toolError(mapApiError(err));
    }
  });
}
