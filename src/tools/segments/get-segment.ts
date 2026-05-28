import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Segment } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_segment";
const TOOL_DESCRIPTION =
  "Get a single segment definition by ID from the Adobe Experience Platform Unified Profile Service. " +
  "Returns the full segment object including its PQL expression, schema reference, evaluation info, " +
  "TTL, and state.";

const inputSchema = {
  segmentId: z
    .string()
    .min(1)
    .describe("The AEP segment definition ID"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Segments",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { segmentId } = args;

      try {
        logger.info({ tool: TOOL_NAME, segmentId }, "Fetching segment");

        // Segment IDs are URL-encoded as a path segment in case they
        // contain characters that need escaping.
        const encodedId = encodeURIComponent(segmentId);

        const segment = await ctx.client.request<Segment>({
          method: "GET",
          path: `/data/core/ups/segment/definitions/${encodedId}`,
        });

        return toolResult(segment);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, segmentId, err },
          "Failed to fetch segment",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
