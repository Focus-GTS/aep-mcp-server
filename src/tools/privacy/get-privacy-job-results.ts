import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { PrivacyJobResults } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { describe } from "../../util/metadata.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_get_privacy_job_results";
const TOOL_DESCRIPTION =
  "Fetch the results bundle for a completed Adobe Privacy Service job. For 'access' " +
  "actions the response includes a 'downloadURL' (typically a short-lived signed URL) " +
  "carrying the exported personal data. For 'delete' actions the response summarises " +
  "per-product processing status. Only meaningful once the job has reached 'complete' " +
  "status — poll aep_get_privacy_job first.";

const inputSchema = {
  jobId: z
    .string()
    .min(1)
    .describe(
      "Privacy job ID whose results should be retrieved. Job must be in 'complete' status.",
    ),
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

      logger.info({ tool: TOOL_NAME, jobId }, "Fetching privacy job results");

      try {
        const encodedId = encodeURIComponent(jobId);
        const results = await ctx.client.get<PrivacyJobResults>(
          `/data/core/privacy/jobs/${encodedId}/results`,
        );

        logger.info(
          {
            tool: TOOL_NAME,
            jobId,
            status: results?.status,
            hasDownloadURL: Boolean(results?.downloadURL),
          },
          "Privacy job results fetched",
        );

        return toolResult(results);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, jobId, err },
          "Failed to fetch privacy job results",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
