import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { describe } from "../../util/metadata.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_cancel_privacy_job";
const TOOL_DESCRIPTION =
  "Cancel a pending Adobe Privacy Service job. Cancellation only succeeds while the " +
  "job is still in 'submitted' or 'processing' state — jobs that have already " +
  "completed cannot be reversed (use aep_get_privacy_job first to confirm the " +
  "current status). Cancellation is auditable in Adobe Privacy Service.";

const inputSchema = {
  jobId: z
    .string()
    .min(1)
    .describe(
      "Privacy job ID to cancel. Obtain from aep_create_privacy_job or aep_list_privacy_jobs.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Privacy Service",
        category: "Privacy",
        operation: "execute",
        requiresEntitlement: "Adobe Privacy Service",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { jobId } = args;

      logger.warn({ jobId }, "Cancelling privacy job");

      try {
        const encodedId = encodeURIComponent(jobId);
        const response = await ctx.client.post<unknown>(
          `/data/core/privacy/jobs/${encodedId}/cancel`,
        );

        const cancelledAt = new Date().toISOString();

        logger.info(
          { tool: TOOL_NAME, jobId, cancelledAt },
          "Privacy job cancellation accepted",
        );

        return toolResult({
          success: true,
          jobId,
          cancelledAt,
          message:
            "Privacy job cancellation request accepted. Use aep_get_privacy_job to " +
            "confirm the job's final status.",
          rawResponse: response ?? null,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, jobId, err },
          "Failed to cancel privacy job",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
