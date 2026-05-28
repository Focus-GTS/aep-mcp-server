import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Query } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_get_query_status";
const TOOL_DESCRIPTION =
  "Get the current status of a previously submitted AEP Query Service query by its ID. " +
  "Returns the Query object including state (QUEUED/RUNNING/SUCCESS/FAILED/CANCELED), " +
  "rowCount, resultLocation, and any errors. If the query is still RUNNING the response " +
  "includes guidance to poll again. When includeResults=true and the query has completed " +
  "successfully, a sample of the result rows is fetched from resultLocation and embedded.";

const RESULT_SAMPLE_LIMIT = 100;

const inputSchema = {
  queryId: z
    .string()
    .min(1)
    .describe("The query ID returned by 'aep_run_query'"),
  includeResults: z
    .boolean()
    .default(false)
    .describe(
      "If true AND state is SUCCESS AND resultLocation is available, fetch a sample of the " +
        "result rows (up to 100) and include them under 'resultsSample' in the response.",
    ),
};

interface QueryResultsResponse {
  rows?: unknown[];
  results?: unknown[];
  data?: unknown[];
  schema?: unknown;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { queryId, includeResults } = args;

    try {
      logger.debug({ tool: TOOL_NAME, queryId, includeResults }, "Fetching query status");

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

      if (
        includeResults &&
        query.state === "SUCCESS" &&
        typeof query.resultLocation === "string" &&
        query.resultLocation.length > 0
      ) {
        try {
          logger.debug(
            { tool: TOOL_NAME, queryId, resultLocation: query.resultLocation },
            "Fetching query results",
          );

          const results = await ctx.client.request<QueryResultsResponse>({
            method: "GET",
            path: query.resultLocation,
            query: { limit: RESULT_SAMPLE_LIMIT },
          });

          const rows =
            results.rows ?? results.results ?? results.data ?? [];

          response.resultsSample = {
            sampleSize: Array.isArray(rows) ? rows.length : 0,
            sampleLimit: RESULT_SAMPLE_LIMIT,
            totalRowCount: query.rowCount,
            schema: results.schema,
            rows,
          };
        } catch (resultsErr) {
          logger.warn(
            { tool: TOOL_NAME, queryId, err: resultsErr },
            "Failed to fetch query results sample",
          );
          response.resultsFetchError = mapApiError(resultsErr);
        }
      } else if (includeResults && query.state === "SUCCESS") {
        response._hint =
          "Query succeeded but no resultLocation was returned (the query may not have produced rows).";
      }

      return toolResult(response);
    } catch (err) {
      logger.error({ tool: TOOL_NAME, queryId, err }, "Failed to fetch query status");
      return toolError(mapApiError(err));
    }
  });
}
