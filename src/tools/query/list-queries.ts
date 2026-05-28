import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Query } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_queries";
const TOOL_DESCRIPTION =
  "List queries submitted to the Adobe Experience Platform Query Service for the active sandbox. " +
  "Supports filtering by state (QUEUED/RUNNING/SUCCESS/FAILED/CANCELED), excluding system/hidden " +
  "queries, ordering (e.g. '-created' for newest first), and an ISO 'startTime' filter that maps to " +
  "Adobe's 'start' query param.\n" +
  "\n" +
  "PAGINATION: Adobe Query Service uses cursor-based pagination, NOT offset-based. To page through " +
  "results, pass the 'nextCursor' value returned by a previous call as the 'cursor' input on the next " +
  "call. The 'start' query param in Adobe's API is an ISO timestamp filter (mapped here from 'startTime'), " +
  "NOT a row offset.";

const QUERY_STATES = [
  "QUEUED",
  "RUNNING",
  "SUCCESS",
  "FAILED",
  "CANCELED",
] as const;

const inputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of results to return (1-100)"),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Opaque pagination cursor. Pass the 'nextCursor' value returned by a previous call to fetch " +
        "the next page. Omit to start from the beginning.",
    ),
  startTime: z
    .string()
    .datetime()
    .optional()
    .describe(
      "Optional ISO-8601 timestamp filter — only queries created at or after this time are returned. " +
        "Maps to Adobe's 'start' query parameter.",
    ),
  state: z
    .enum(QUERY_STATES)
    .optional()
    .describe("Filter by query state. Omit to list queries in all states."),
  excludeHidden: z
    .boolean()
    .default(true)
    .describe(
      "Hide system-generated queries (recommended). Set false to include hidden queries.",
    ),
  orderby: z
    .string()
    .optional()
    .describe(
      "Sort order field. Prefix with '-' for descending. Defaults to '-created' (newest first). " +
        "Examples: '-created', 'created', '-updated'.",
    ),
};

interface QueryListResponse extends AepListResponse<Query> {
  _page?: { next?: string; prev?: string; [key: string]: unknown };
}

function extractNextCursor(response: QueryListResponse): string | undefined {
  const nextHref = response._links?.next?.href;
  if (typeof nextHref === "string" && nextHref.length > 0) {
    // The next link may be a full URL or a relative path with the cursor in
    // the query string. Surface the raw value — callers pass it back via 'cursor'.
    return nextHref;
  }
  if (
    typeof response._page?.next === "string" &&
    response._page.next.length > 0
  ) {
    return response._page.next;
  }
  return undefined;
}

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
      const { limit, cursor, startTime, state, excludeHidden, orderby } = args;
      const effectiveOrderby = orderby ?? "-created";

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            limit,
            cursor,
            startTime,
            state,
            excludeHidden,
            orderby: effectiveOrderby,
          },
          "Listing queries",
        );

        const query: Record<string, string | number | boolean | undefined> = {
          limit,
          property: state ? `state==${state}` : undefined,
          excludeHidden,
          orderby: effectiveOrderby,
          start: startTime,
          cursor,
        };

        const response = await ctx.client.request<QueryListResponse>({
          method: "GET",
          path: "/data/foundation/query/queries",
          query,
        });

        const results =
          response.results ??
          response.children ??
          response._embedded?.results ??
          [];

        const nextCursor = extractNextCursor(response);

        return toolResult({
          results,
          count: results.length,
          limit,
          nextCursor,
          hasMore: Boolean(nextCursor),
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to list queries");
        return toolError(mapApiError(err));
      }
    },
  );
}
