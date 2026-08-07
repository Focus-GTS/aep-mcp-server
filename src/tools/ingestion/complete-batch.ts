import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_complete_batch";
const TOOL_DESCRIPTION =
  "Signal that all files have been uploaded to an Adobe Experience Platform ingestion " +
  "batch and hand it off for processing. This is step 3 of 3 in the AEP batch ingestion " +
  "flow (aep_create_batch → aep_upload_batch_file → this). Until this is called, uploaded " +
  "files sit in the batch and no data reaches the dataset or Real-Time Customer Profile. " +
  "Completion is one-way: a completed batch cannot accept further files, so upload " +
  "everything first. Processing is asynchronous — poll aep_get_batch_status to watch the " +
  "batch move through loading/staging to success or failure.";

const inputSchema = {
  batchId: z
    .string()
    .min(1)
    .describe(
      "The batch ID to mark complete, as returned by aep_create_batch. All files " +
        "must already be uploaded — no further uploads are accepted after this call.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Ingestion",
        operation: "execute",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { batchId } = args;

      try {
        logger.info({ tool: TOOL_NAME, batchId }, "Completing ingestion batch");

        const encodedBatchId = encodeURIComponent(batchId);

        // Adobe answers this POST with 200 and an empty body on success.
        const response = await ctx.client.request<unknown>({
          method: "POST",
          path: `/data/foundation/import/batches/${encodedBatchId}`,
          query: { action: "COMPLETE" },
        });

        logger.info(
          { tool: TOOL_NAME, batchId },
          "Ingestion batch completed and queued for processing",
        );

        return toolResult({
          batchId,
          completed: true,
          ...(response && typeof response === "object" ? response : {}),
          _nextStep:
            `Batch ${batchId} is queued for processing. Poll aep_get_batch_status ` +
            `with this batchId until status is 'success' or 'failure' — ingestion is asynchronous.`,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, batchId, err },
          "Failed to complete ingestion batch",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
