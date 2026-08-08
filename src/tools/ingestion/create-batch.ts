import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Batch } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_batch";
const TOOL_DESCRIPTION =
  "Create a new batch for ingesting data into an Adobe Experience Platform dataset. " +
  "This is step 1 of 3 in the AEP batch ingestion flow: create the (empty) batch here, " +
  "upload one or more files into it with aep_upload_batch_file, then seal it with " +
  "aep_complete_batch to hand it off for processing. Nothing is ingested until the " +
  "batch is completed. Returns the created batch including its server-assigned `id`, " +
  "which every subsequent call in the flow requires. The file format declared here " +
  "must match the files you upload — a batch created as `json` will fail validation " +
  "if you upload Parquet.";

const inputSchema = {
  datasetId: z
    .string()
    .min(1)
    .describe(
      "The target dataset ID to ingest into (as returned by aep_list_datasets). " +
        "The dataset's XDM schema determines which records will validate.",
    ),
  format: z
    .enum(["json", "parquet", "csv"])
    .describe(
      "File format of the data being uploaded. 'json' expects newline-delimited " +
        "JSON (one XDM record per line) — this is the most common choice. 'parquet' " +
        "expects Parquet files conforming to the dataset schema. 'csv' requires the " +
        "dataset to be configured for CSV ingestion.",
    ),
};

interface BatchCreateResponse {
  id?: string;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Ingestion",
        operation: "write",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { datasetId, format } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, datasetId, format },
          "Creating ingestion batch",
        );

        const response = await ctx.client.request<
          BatchCreateResponse | Batch
        >({
          method: "POST",
          path: "/data/foundation/import/batches",
          body: {
            datasetId,
            inputFormat: { format },
          },
        });

        const created = response as Batch;

        logger.info(
          { tool: TOOL_NAME, batchId: created?.id, datasetId, format },
          "Ingestion batch created",
        );

        return toolResult({
          ...created,
          _nextStep:
            `Upload files with aep_upload_batch_file (batchId: ${created?.id}, ` +
            `datasetId: ${datasetId}), then call aep_complete_batch to start processing.`,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datasetId, format, err },
          "Failed to create ingestion batch",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
