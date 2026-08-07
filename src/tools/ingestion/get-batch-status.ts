import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Batch } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_batch_status";
const TOOL_DESCRIPTION =
  "Get the processing status and metrics of an Adobe Experience Platform ingestion batch. " +
  "Use this to poll a batch after aep_complete_batch — ingestion is asynchronous and a " +
  "batch typically moves loading → staging → success over seconds to minutes depending on " +
  "size. Terminal states are 'success' (data is in the dataset), 'failure' (validation or " +
  "processing failed — check the `errors` field), and 'abandoned' (created but never " +
  "completed). Also returns metrics including input/output record counts, so a batch that " +
  "reports 'success' with a failedRecordCount above zero can be spotted as a partial load.";

/** Batch states after which polling should stop. */
const TERMINAL_STATUSES = new Set(["success", "failure", "abandoned", "aborted"]);

const inputSchema = {
  batchId: z
    .string()
    .min(1)
    .describe("The batch ID to check, as returned by aep_create_batch"),
};

/**
 * The Catalog Service keys single-batch lookups by batch ID
 * (`{ "<batchId>": { ... } }`) rather than returning the batch directly.
 * Older responses return the object bare, so handle both.
 */
function extractBatch(response: unknown, batchId: string): Batch | null {
  if (!response || typeof response !== "object") {
    return null;
  }
  const record = response as Record<string, unknown>;

  const keyed = record[batchId];
  if (keyed && typeof keyed === "object") {
    return { ...(keyed as Batch), id: batchId };
  }

  // Bare object that already looks like a batch.
  if ("status" in record || "metrics" in record || "id" in record) {
    return { ...(record as Batch), id: (record.id as string) ?? batchId };
  }

  // Single-entry map under an unexpected key.
  const entries = Object.entries(record);
  if (entries.length === 1) {
    const [key, value] = entries[0];
    if (value && typeof value === "object") {
      return { ...(value as Batch), id: key };
    }
  }

  return null;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Ingestion",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { batchId } = args;

      try {
        logger.info({ tool: TOOL_NAME, batchId }, "Fetching batch status");

        const encodedBatchId = encodeURIComponent(batchId);

        const response = await ctx.client.request<unknown>({
          method: "GET",
          path: `/data/foundation/catalog/batches/${encodedBatchId}`,
        });

        const batch = extractBatch(response, batchId);

        if (!batch) {
          logger.warn(
            { tool: TOOL_NAME, batchId },
            "Batch lookup returned no recognizable batch",
          );
          return toolError({
            code: "BATCH_NOT_FOUND",
            message:
              `No batch found with ID ${batchId}. Verify the ID returned by ` +
              `aep_create_batch, and note that batches are sandbox-scoped.`,
          });
        }

        const status = typeof batch.status === "string" ? batch.status : undefined;
        const isTerminal = status ? TERMINAL_STATUSES.has(status) : false;

        logger.info(
          { tool: TOOL_NAME, batchId, status, isTerminal },
          "Batch status fetched",
        );

        return toolResult({
          ...batch,
          _isTerminal: isTerminal,
          _pollingHint: isTerminal
            ? `Batch reached terminal state '${status}'. Stop polling.`
            : `Batch is still processing (status: ${status ?? "unknown"}). ` +
              `Poll again in a few seconds.`,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, batchId, err },
          "Failed to fetch batch status",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
