import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Query } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_query_status";
const TOOL_DESCRIPTION =
  "Get the current status of a previously submitted AEP Query Service query by its ID. " +
  "Returns the Query metadata object including state (QUEUED/RUNNING/SUCCESS/FAILED/CANCELED), " +
  "rowCount, resultLocation, and any errors. If the query is still RUNNING or QUEUED, the response " +
  "includes a hint to poll again.\n" +
  "\n" +
  "RESULT DATA IS NOT FETCHED BY THIS TOOL. Adobe Query Service returns row-level results via a " +
  "PostgreSQL-compatible interface, NOT through the REST API. To retrieve actual result rows, " +
  "connect to Adobe's Query Service PostgreSQL endpoint using the connection credentials shown in " +
  "the AEP UI (Queries > Credentials). This tool returns query metadata and status only.";

const inputSchema = {
  queryId: z
    .string()
    .min(1)
    .describe("The query ID returned by 'aep_run_query'"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "AEP Query Service",
        category: "Query Service",
        operation: "read",
        requiresEntitlement: "Query Service",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { queryId } = args;

      try {
        logger.debug({ tool: TOOL_NAME, queryId }, "Fetching query status");

        const encodedId = encodeURIComponent(queryId);

        const query = await ctx.client.request<Query>({
          method: "GET",
          path: `/data/foundation/query/queries/${encodedId}`,
        });

        const response: Record<string, unknown> = { ...query };

        if (query.state === "RUNNING" || query.state === "QUEUED") {
          response._hint =
            "Query still running. Poll again in a few seconds by calling 'aep_get_query_status' with the same queryId.";
        }

        if (query.state === "FAILED") {
          response._hint =
            "Query failed. See 'errors' for details. Fix the SQL and resubmit with 'aep_run_query'.";
        }

        if (query.state === "SUCCESS") {
          response._hint =
            "Query succeeded. Result rows are NOT returned by this MCP — fetch them via Adobe's " +
            "Query Service PostgreSQL endpoint (credentials in the AEP UI: Queries > Credentials).";
        }

        return toolResult(response);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, queryId, err },
          "Failed to fetch query status",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
