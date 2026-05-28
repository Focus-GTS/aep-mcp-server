import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, XdmSchema } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_schemas";
const TOOL_DESCRIPTION =
  "List XDM schemas from the Adobe Experience Platform Schema Registry. " +
  "Returns a lightweight, paginated list (IDs and titles) for the tenant or global container.";

const inputSchema = {
  ...paginationSchema,
  containerType: z
    .enum(["tenant", "global"])
    .default("tenant")
    .describe(
      "Schema registry container: 'tenant' for org-specific schemas, 'global' for Adobe-defined schemas",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, containerType } = args;

    try {
      logger.debug({ tool: TOOL_NAME, limit, offset, containerType }, "Listing schemas");

      const response = await ctx.client.request<AepListResponse<XdmSchema>>({
        method: "GET",
        path: `/data/foundation/schemaregistry/${containerType}/schemas`,
        query: {
          // AEP uses property/orderby for paging; we request a window large enough
          // to slice locally so we can present a clean offset/limit interface.
          start: offset,
          limit,
        },
        headers: {
          Accept: "application/vnd.adobe.xed-id+json",
        },
      });

      const allResults =
        response.results ?? response.children ?? response._embedded?.results ?? [];

      const total = response.count ?? response.total ?? allResults.length + offset;

      return toolResult(
        buildPaginatedResponse<XdmSchema>(allResults, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list schemas");
      return toolError(mapApiError(err));
    }
  });
}
