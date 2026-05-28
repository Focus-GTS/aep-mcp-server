import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, SourceCatalog } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_sources";
const TOOL_DESCRIPTION =
  "List available source connectors from the Adobe Experience Platform Flow Service catalog. " +
  "These are connection specifications (templates) for ingesting data from external systems " +
  "(databases, cloud storage, advertising, marketing platforms, etc.). " +
  "Returns a paginated list, optionally filtered by category.";

const inputSchema = {
  ...paginationSchema,
  category: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional category filter (e.g. 'database', 'cloudStorage', 'advertising', 'marketing'). " +
        "Matched case-insensitively against the connector's category.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, category } = args;

    try {
      logger.debug({ tool: TOOL_NAME, limit, offset, category }, "Listing source connectors");

      const response = await ctx.client.request<AepListResponse<SourceCatalog>>({
        method: "GET",
        path: "/data/foundation/flowservice/connectionSpecs",
        query: {
          property: "providerId==SOURCES",
        },
      });

      let allResults =
        response.results ?? response.children ?? response._embedded?.results ?? [];

      if (category) {
        const needle = category.toLowerCase();
        allResults = allResults.filter(
          (source) => (source.category ?? "").toLowerCase() === needle,
        );
      }

      const total = response.count ?? response.total ?? allResults.length;
      const paginated = allResults.slice(offset, offset + limit);

      return toolResult(
        buildPaginatedResponse<SourceCatalog>(paginated, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list source connectors");
      return toolError(mapApiError(err));
    }
  });
}
