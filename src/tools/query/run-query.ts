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

/**
 * Builds the Query Service database name for the sandbox this server is
 * configured against.
 *
 * AEP database names are `{sandbox}:{database}`. This was previously
 * hardcoded to `"prod:all"`, which meant a server started with
 * AEP_SANDBOX_NAME=dev still submitted queries naming the prod sandbox —
 * contradicting the server's own "all operations scoped to a single sandbox"
 * guarantee.
 */
function defaultDbName(sandboxName: string): string {
  return `${sandboxName}:all`;
}

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
      "Target database name in '{sandbox}:{database}' form. Defaults to " +
        "'<configured sandbox>:all', derived from AEP_SANDBOX_NAME — the main data lake DB " +
        "for the sandbox this server is scoped to. Override only to target a different database.",
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

      // Scope to the sandbox this server was started with, unless the caller
      // explicitly overrides. Previously hardcoded to prod.
      const effectiveDbName =
        dbName ?? defaultDbName(ctx.credentials.sandboxName);

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            name,
            dbName: effectiveDbName,
            sandbox: ctx.credentials.sandboxName,
            sqlLength: sql.length,
          },
          "Submitting query",
        );

        const body = {
          name,
          description,
          dbName: effectiveDbName,
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
          dbName: effectiveDbName,
          sandbox: ctx.credentials.sandboxName,
          _hint:
            "Query is running asynchronously. Poll 'aep_get_query_status' with this queryId " +
            "until state is SUCCESS. NOTE: result ROWS are not retrievable over REST — " +
            "Adobe serves them through the Query Service PostgreSQL endpoint (credentials in " +
            "the AEP UI under Queries > Credentials). aep_get_query_status returns metadata only.",
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to submit query");
        return toolError(mapApiError(err));
      }
    },
  );
}
