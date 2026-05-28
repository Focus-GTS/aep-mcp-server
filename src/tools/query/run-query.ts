import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Query } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_run_query";
const TOOL_DESCRIPTION =
  "Submit a SQL query to the Adobe Experience Platform Query Service against the data lake. " +
  "This is an ASYNCHRONOUS operation: the response contains the query 'id' and an initial 'state' " +
  "(typically QUEUED or RUNNING) but NOT the result rows. Use 'aep_get_query_status' with the " +
  "returned queryId to poll for completion and retrieve results once 'state' is SUCCESS.";

const DEFAULT_DB_NAME = "prod:all";

const inputSchema = {
  sql: z
    .string()
    .min(1)
    .describe(
      "The SQL query to execute against the data lake (PostgreSQL-compatible dialect). " +
        "Example: SELECT * FROM my_dataset LIMIT 10",
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Optional friendly name for the query (helps identify it in query history)",
    ),
  description: z
    .string()
    .optional()
    .describe("Optional human-readable description of what the query does"),
  dbName: z
    .string()
    .optional()
    .describe(
      `Target database name. Defaults to '${DEFAULT_DB_NAME}' which is the sandbox's main data lake DB.`,
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "AEP Query Service",
        category: "Query Service",
        operation: "execute",
        requiresEntitlement: "Query Service",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { sql, name, description, dbName } = args;

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            name,
            dbName: dbName ?? DEFAULT_DB_NAME,
            sqlLength: sql.length,
          },
          "Submitting query",
        );

        const body = {
          name,
          description,
          dbName: dbName ?? DEFAULT_DB_NAME,
          sql,
          queryParameters: {},
        };

        const query = await ctx.client.request<Query>({
          method: "POST",
          path: "/data/foundation/query/queries",
          body,
        });

        logger.info(
          { tool: TOOL_NAME, queryId: query.id, state: query.state },
          "Query submitted",
        );

        return toolResult({
          ...query,
          _hint:
            "Query is running asynchronously. Use 'aep_get_query_status' with this queryId " +
            "to poll for completion. Pass includeResults=true once state is SUCCESS to fetch result data.",
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to submit query");
        return toolError(mapApiError(err));
      }
    },
  );
}
