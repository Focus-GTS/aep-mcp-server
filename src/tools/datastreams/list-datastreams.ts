import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Datastream } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";
import { DATASTREAMS_BASE_PATH } from "./paths.js";

const TOOL_NAME = "aep_list_datastreams";
const TOOL_DESCRIPTION =
  "List Adobe Experience Platform Edge Network datastreams for the current sandbox. " +
  "Datastreams route incoming events from the Web SDK, Mobile SDK, and Server SDK to " +
  "downstream Adobe services (AJO, Target, Analytics, AEP, Audience Manager). " +
  "Returns a paginated list of datastreams with their IDs, names, and configuration metadata." +
  "ENDPOINT UNDOCUMENTED — LIVE VALIDATION PENDING. Adobe publishes no REST API for datastream configuration; this tool's path is not documentation-supported and has never been confirmed against a live tenant. Blocked on Adobe case SALES0855734. See docs/datastream-endpoint-investigation-2026-08-12.md.";

const inputSchema = {
  ...paginationSchema,
};

interface DatastreamListResponse {
  data?: Datastream[];
  _page?: {
    count?: number;
    total?: number;
    limit?: number;
    start?: number;
  };
  _links?: Record<string, unknown>;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Datastreams",
        operation: "read",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { limit, offset } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, limit, offset },
          "Listing datastreams",
        );

        const response = await ctx.client.request<
          DatastreamListResponse | Datastream[]
        >({
          method: "GET",
          path: DATASTREAMS_BASE_PATH,
          query: {
            start: offset,
            limit,
          },
        });

        // Adobe's Data Collection API sometimes returns { data: [...] } and
        // sometimes returns a bare array. Handle both shapes.
        const allResults: Datastream[] = Array.isArray(response)
          ? response
          : (response.data ?? []);

        // Only `_page.total` is a real cross-page total. The old fallback of
        // `allResults.length + offset` made hasMore mathematically always
        // false; omitting it lets the full-page heuristic take over instead.
        const reportedTotal = Array.isArray(response)
          ? undefined
          : response._page?.total;

        const page = buildPaginatedResponse<Datastream>(
          allResults,
          { limit, offset },
          typeof reportedTotal === "number" ? { total: reportedTotal } : {},
        );

        logger.info(
          {
            tool: TOOL_NAME,
            count: page.count,
            total: page.total,
            hasMore: page.hasMore,
          },
          "Datastreams listed",
        );

        return toolResult(page);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list datastreams",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
