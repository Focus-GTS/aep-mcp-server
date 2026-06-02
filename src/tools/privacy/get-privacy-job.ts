import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { PrivacyJob } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { describe } from "../../util/metadata.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_get_privacy_job";
const TOOL_DESCRIPTION =
  "Get the current status and details of a single Adobe Privacy Service job by its " +
  "jobId. Returns regulation, action, submission/modification dates, per-product " +
  "processing responses, and overall status (submitted/processing/complete/error/cancelled). " +
  "Use this to poll a job after submitting via aep_create_privacy_job.";

const inputSchema = {
  jobId: z
    .string()
    .min(1)
    .describe("Privacy job ID returned from aep_create_privacy_job"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Privacy Service",
        category: "Privacy",
        operation: "read",
        requiresEntitlement: "Adobe Privacy Service",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { jobId } = args;

      logger.info({ tool: TOOL_NAME, jobId }, "Fetching privacy job");

      try {
        const encodedId = encodeURIComponent(jobId);
        const job = await ctx.client.get<PrivacyJob>(
          `/data/core/privacy/jobs/${encodedId}`,
        );

        logger.info(
          { tool: TOOL_NAME, jobId, status: job?.status },
          "Privacy job fetched",
        );

        return toolResult(job);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, jobId, err },
          "Failed to fetch privacy job",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
