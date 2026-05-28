import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { SegmentSizeEstimate } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_estimate_segment_size";
const TOOL_DESCRIPTION =
  "Estimate the qualifying audience size for a segment in the Adobe Experience Platform Unified Profile " +
  "Service. Pass 'segmentId' to estimate an existing segment definition, OR pass 'pqlExpression' to preview " +
  "the size of a candidate PQL query without persisting it. At least one of the two must be provided. " +
  "Returns the estimated total profile size and TTL metadata.";

const inputSchema = {
  segmentId: z
    .string()
    .min(1)
    .optional()
    .describe("ID of an existing segment definition to estimate"),
  pqlExpression: z
    .string()
    .min(1)
    .optional()
    .describe("A PQL/text expression to estimate without persisting a segment definition"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { segmentId, pqlExpression } = args;

    if (!segmentId && !pqlExpression) {
      return toolError({
        code: "INVALID_INPUT",
        message:
          "Either 'segmentId' or 'pqlExpression' must be provided to estimate segment size.",
      });
    }

    if (segmentId && pqlExpression) {
      return toolError({
        code: "INVALID_INPUT",
        message:
          "Provide only one of 'segmentId' or 'pqlExpression', not both.",
      });
    }

    try {
      logger.debug(
        { tool: TOOL_NAME, mode: segmentId ? "byId" : "byExpression" },
        "Estimating segment size",
      );

      const body: Record<string, unknown> = segmentId
        ? { segmentId }
        : { predicateExpression: pqlExpression, predicateType: "pql/text" };

      const estimate = await ctx.client.request<SegmentSizeEstimate>({
        method: "POST",
        path: "/data/core/ups/segment/estimate",
        body,
      });

      return toolResult(estimate);
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to estimate segment size");
      return toolError(mapApiError(err));
    }
  });
}
