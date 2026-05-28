import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Dataflow } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_dataflows";
const TOOL_DESCRIPTION =
  "List dataflows configured in the Adobe Experience Platform Flow Service. " +
  "Dataflows are running ingestion or activation pipelines connecting a source to a target. " +
  "Returns a paginated list, optionally filtered by state (ENABLED/DISABLED) or a raw AEP property filter " +
  "such as 'name==myFlow'. When both 'state' and 'propertyFilter' are supplied, they are sent as repeated " +
  "'property' query params and AND-combined server-side by Adobe.";

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
        "When combined with 'state', both are sent as repeated property params (AND semantics).",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Sources",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, offset, state, propertyFilter } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, limit, offset, state, propertyFilter },
          "Listing dataflows",
        );

        // Adobe Flow Service expects repeated &property= entries for AND-combined
        // filters — NOT comma-separated. The auth client supports array values.
        const propertyFilters: string[] = [];
        if (state) propertyFilters.push(`state==${state}`);
        if (propertyFilter) propertyFilters.push(propertyFilter);

        const query: Record<
          string,
          string | number | boolean | string[] | undefined
        > = {
          start: offset,
          limit,
          property: propertyFilters.length > 0 ? propertyFilters : undefined,
        };

        const response = await ctx.client.request<AepListResponse<Dataflow>>({
          method: "GET",
          path: "/data/foundation/flowservice/flows",
          query: query as Record<string, string | number | boolean | undefined>,
        });

        const allResults =
          response.results ??
          response.children ??
          response._embedded?.results ??
          [];

        const total =
          response.count ?? response.total ?? allResults.length + offset;

        return toolResult(
          buildPaginatedResponse<Dataflow>(allResults, total, {
            limit,
            offset,
          }),
        );
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to list dataflows");
        return toolError(mapApiError(err));
      }
    },
  );
}
