import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

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
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "DEFAULTS TO TRUE. Returns the request that would be sent without sending it. " +
        "Pass false, together with the confirmation, to actually complete the batch.",
    ),
  confirm: z
    .string()
    .optional()
    .describe(
      "Required when dryRun is false. Must equal exactly 'COMPLETE BATCH <batchId>' for the " +
        "same id. Bound to the id so a confirmation cannot be reused for a different batch.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Ingestion",
        operation: "execute",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { batchId, dryRun, confirm } = args;

      try {
        const encodedBatchId = encodeURIComponent(batchId);
        const requestSpec = {
          method: "POST" as const,
          path: `/data/foundation/import/batches/${encodedBatchId}`,
          query: { action: "COMPLETE" },
        };

        // COMPLETE is the point of no return for ingestion: it promotes staged
        // files into the data lake. Everything before it can be abandoned by
        // simply not completing the batch. Until 2026-08-16 this tool had
        // neither a dry run nor a confirmation — the least-guarded write in the
        // repo was also the only irreversible one.
        if (dryRun) {
          logger.info({ tool: TOOL_NAME, batchId }, "DRY RUN — no COMPLETE sent");
          return toolResult({
            dryRun: true,
            sent: false,
            wouldSend: requestSpec,
            _warning:
              "COMPLETE promotes staged files into the data lake. It cannot be undone by " +
              "abandoning the batch — removal afterwards requires REVERT.",
            _nextStep:
              `To complete, re-run with dryRun=false and confirm='COMPLETE BATCH ${batchId}'.`,
          });
        }

        const expectedConfirm = `COMPLETE BATCH ${batchId}`;
        if (confirm !== expectedConfirm) {
          logger.warn(
            { tool: TOOL_NAME, batchId, confirmProvided: Boolean(confirm) },
            "Batch completion rejected: confirmation missing or does not match this batch id",
          );
          return toolError({
            code: "CONFIRMATION_REQUIRED",
            message:
              `Completing a batch promotes its staged files into the data lake and cannot be ` +
              `undone by abandoning the batch. Re-invoke with confirm='${expectedConfirm}' ` +
              `(exact match).`,
          });
        }

        logger.warn({ tool: TOOL_NAME, batchId }, "Completing ingestion batch (confirmed)");

        // Adobe answers this POST with 200 and an empty body on success.
        const response = await ctx.client.request<unknown>(requestSpec);

        logger.info(
          { tool: TOOL_NAME, batchId },
          "Ingestion batch completed and queued for processing",
        );

        return toolResult({
          batchId,
          completed: true,
          ...(response && typeof response === "object" ? response : {}),
          _warning:
            "A 200 here is ACCEPTANCE, not ingestion success. The batch is queued; records " +
            "are not in the lake until it reaches a terminal state.",
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
