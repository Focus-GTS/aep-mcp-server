import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, XdmSchema } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
  extractPageHints,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

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
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Schemas",
        operation: "read",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { limit, offset, containerType } = args;

      // Schema Registry pages by opaque cursor, so a numeric offset cannot be
      // honoured. Refusing is the only honest option — silently ignoring it
      // would return page one while the caller believed they had paged.
      if (offset && offset > 0) {
        return toolError({
          code: "UNSUPPORTED_PAGINATION",
          message:
            "Schema Registry pages by an opaque cursor, not a numeric offset, so " +
            "`offset` cannot be honoured for schemas. Raise `limit` instead " +
            "(max 100), or narrow the query. Passing an offset previously " +
            "returned an empty list rather than an error.",
        });
      }

      try {
        logger.debug(
          { tool: TOOL_NAME, limit, offset, containerType },
          "Listing schemas",
        );

        const response = await ctx.client.request<AepListResponse<XdmSchema>>({
          method: "GET",
          path: `/data/foundation/schemaregistry/${containerType}/schemas`,
          // Schema Registry's `start` is an OPAQUE CURSOR, not a numeric
          // offset. Verified live 2026-08-14 against a sandbox holding
          // schemas:
          //
          //   ?limit=10            -> 10 results
          //   ?limit=10&start=0    ->  0 results   <-- silently empty
          //   ?limit=10&start=''   -> 10 results
          //
          // This tool previously sent `start: offset` unconditionally. Since
          // offset defaults to 0, EVERY call sent start=0 and returned an
          // empty list — on any sandbox, however many schemas it held. The
          // failure was silent: a 200 with zero results is indistinguishable
          // from a genuinely empty registry, and it was reported as fact in a
          // validation report before anyone checked it against a raw call.
          //
          // Numeric offsets cannot work against a cursor API, so paging is not
          // simulated here. `offset` is rejected above rather than quietly
          // producing wrong results.
          query: { limit },
          headers: {
            Accept: "application/vnd.adobe.xed-id+json",
          },
        });

        const allResults =
          response.results ??
          response.children ??
          response._embedded?.results ??
          [];

        // Schema Registry's top-level `count` is a PAGE count, not a total —
        // extractPageHints deliberately ignores it so hasMore stays honest.
        return toolResult(
          buildPaginatedResponse<XdmSchema>(
            allResults,
            { limit, offset },
            extractPageHints(response),
          ),
        );
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to list schemas");
        return toolError(mapApiError(err));
      }
    },
  );
}
