import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Dataflow } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_dataflows";
const TOOL_DESCRIPTION =
  "List dataflows configured in the Adobe Experience Platform Flow Service. " +
  "Dataflows are running ingestion or activation pipelines connecting a source to a target. " +
  "Returns a paginated list, optionally filtered by state (ENABLED/DISABLED) or a raw AEP property filter " +
  "such as 'name==myFlow'.";

const inputSchema = {
  ...paginationSchema,
  state: z
    .enum(["ENABLED", "DISABLED"])
    .optional()
    .describe("Optional state filter"),
  propertyFilter: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional raw AEP Flow Service property filter (e.g. 'name==myFlow' or 'sourceConnectionIds==abc'). " +
        "Combined with the state filter via comma-separated AND semantics.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, state, propertyFilter } = args;

    try {
      logger.debug(
        { tool: TOOL_NAME, limit, offset, state, propertyFilter },
        "Listing dataflows",
      );

      const properties: string[] = [];
      if (state) properties.push(`state==${state}`);
      if (propertyFilter) properties.push(propertyFilter);

      const response = await ctx.client.request<AepListResponse<Dataflow>>({
        method: "GET",
        path: "/data/foundation/flowservice/flows",
        query: {
          start: offset,
          limit,
          ...(properties.length > 0 ? { property: properties.join(",") } : {}),
        },
      });

      const allResults =
        response.results ?? response.children ?? response._embedded?.results ?? [];

      const total = response.count ?? response.total ?? allResults.length + offset;

      return toolResult(
        buildPaginatedResponse<Dataflow>(allResults, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list dataflows");
      return toolError(mapApiError(err));
    }
  });
}
