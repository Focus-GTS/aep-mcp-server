import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, PrivacyNamespace } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { describe } from "../../util/metadata.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_privacy_namespaces";
const TOOL_DESCRIPTION =
  "List the identity namespaces supported by Adobe Privacy Service for the current " +
  "org. Use this to discover which 'namespace' values are valid for the 'userIDs' " +
  "field of aep_create_privacy_job. Includes both standard namespaces (e.g. 'email', " +
  "'ECID') and any custom namespaces registered for the org. Pagination is applied " +
  "client-side as Adobe may return a flat array.";

const inputSchema = {
  ...paginationSchema,
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Privacy Service",
        category: "Privacy",
        operation: "read",
        requiresEntitlement: "Adobe Privacy Service",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, offset } = args;

      logger.info(
        { tool: TOOL_NAME, limit, offset },
        "Listing privacy namespaces",
      );

      try {
        const response = await ctx.client.get<
          AepListResponse<PrivacyNamespace> | PrivacyNamespace[]
        >("/data/core/privacy/namespaces");

        // Adobe may return either a HAL-style wrapper or a flat array.
        const allResults: PrivacyNamespace[] = Array.isArray(response)
          ? response
          : (response.results ??
            response.children ??
            response._embedded?.results ??
            []);

        // Always paginate client-side for this endpoint — Adobe does not
        // expose limit/offset on /privacy/namespaces.
        const total = allResults.length;
        const page = allResults.slice(offset, offset + limit);

        logger.info(
          { tool: TOOL_NAME, total, returned: page.length },
          "Privacy namespaces listed",
        );

        return toolResult(
          buildPaginatedResponse<PrivacyNamespace>(page, total, {
            limit,
            offset,
          }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list privacy namespaces",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
