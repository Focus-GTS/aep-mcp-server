import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, Segment } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
  extractPageHints,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_segments";
const TOOL_DESCRIPTION =
  "List segment definitions from the Adobe Experience Platform Unified Profile Service. " +
  "Returns a paginated list of segments, optionally filtered by state (ACTIVE/INACTIVE/DRAFT) " +
  "or by a case-insensitive name substring match (filtered client-side after the API call).";

const inputSchema = {
  ...paginationSchema,
  state: z
    .enum(["ACTIVE", "INACTIVE", "DRAFT"])
    .optional()
    .describe("Optional segment state filter"),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Optional case-insensitive substring match on segment name"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Segments",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, offset, state, name } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, limit, offset, state, name },
          "Listing segments",
        );

        const response = await ctx.client.request<AepListResponse<Segment>>({
          method: "GET",
          path: "/data/core/ups/segment/definitions",
          query: {
            start: offset,
            limit,
            ...(state ? { property: `state==${state}` } : {}),
          },
        });

        const pageResults =
          response.results ??
          response.children ??
          response._embedded?.results ??
          [];

        const hints = extractPageHints(response);

        if (!name) {
          return toolResult(
            buildPaginatedResponse<Segment>(
              pageResults,
              { limit, offset },
              hints,
            ),
          );
        }

        // The AEP segment definitions endpoint has no server-side name filter,
        // so this match runs client-side over the CURRENT PAGE ONLY. Paging
        // metadata therefore describes the unfiltered result set, not the
        // filtered one — surface that explicitly rather than reporting a
        // misleading count. Callers wanting exhaustive search must page through.
        const needle = name.toLowerCase();
        const filtered = pageResults.filter((segment) =>
          (segment.name ?? "").toLowerCase().includes(needle),
        );

        const page = buildPaginatedResponse<Segment>(
          filtered,
          { limit, offset },
          hints,
        );

        return toolResult({
          ...page,
          scannedOnThisPage: pageResults.length,
          filter: {
            name,
            appliedClientSide: true,
            scope: "current page only",
            note:
              "AEP does not support server-side name filtering on segment definitions. " +
              `${filtered.length} of ${pageResults.length} segments on this page matched. ` +
              "Paging fields (hasMore/total) describe the UNFILTERED result set — " +
              "continue paging to search exhaustively.",
          },
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to list segments");
        return toolError(mapApiError(err));
      }
    },
  );
}
