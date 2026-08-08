import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Batch } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_batches";
const TOOL_DESCRIPTION =
  "List Adobe Experience Platform ingestion batches for the current sandbox. " +
  "Optionally filter to a single dataset with `dataSet` or to a lifecycle state with " +
  "`status`. Use this to audit what has been ingested into a dataset, to find recent " +
  "failures (status: 'failure'), or to spot batches that were created and uploaded to " +
  "but never completed (status: 'abandoned'). Each batch includes its status and " +
  "record-count metrics. Returns a paginated list.";

const BATCH_STATUSES = [
  "queued",
  "processing",
  "loading",
  "loaded",
  "staging",
  "staged",
  "success",
  "failure",
  "abandoned",
  "retrying",
  "stalled",
  "inactive",
  "aborted",
] as const;

const inputSchema = {
  ...paginationSchema,
  dataSet: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional dataset ID to restrict results to batches ingested into that dataset",
    ),
  status: z
    .enum(BATCH_STATUSES)
    .optional()
    .describe(
      "Optional lifecycle state filter. 'success' means the data landed, 'failure' " +
        "means processing failed, 'abandoned' means the batch was never completed.",
    ),
};

/**
 * The Catalog Service returns batches as a map of batch ID → batch object
 * (`{ "<batchId>": { ... } }`) rather than as an array. Normalize to an array
 * with `id` populated, while tolerating an array response from other versions.
 */
function normalizeBatches(response: unknown): Batch[] {
  if (Array.isArray(response)) {
    return response as Batch[];
  }
  if (!response || typeof response !== "object") {
    return [];
  }
  return Object.entries(response as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        // Skip HAL-style metadata keys that sit alongside the batch entries.
        !key.startsWith("_") && value !== null && typeof value === "object",
    )
    .map(([id, value]) => ({ ...(value as Batch), id }));
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Ingestion",
        operation: "read",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { limit, offset, dataSet, status } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, limit, offset, dataSet, status },
          "Listing batches",
        );

        const response = await ctx.client.request<unknown>({
          method: "GET",
          path: "/data/foundation/catalog/batches",
          query: {
            limit,
            start: offset,
            ...(dataSet ? { dataSet } : {}),
            ...(status ? { status } : {}),
          },
        });

        let results = normalizeBatches(response);

        // Client-side filters as a defensive layer in case Catalog ignores a
        // query param, which would otherwise silently return unfiltered results.
        if (status) {
          results = results.filter((batch) => batch.status === status);
        }

        logger.info(
          { tool: TOOL_NAME, count: results.length, dataSet, status },
          "Batches listed",
        );

        return toolResult(
          buildPaginatedResponse<Batch>(results, { limit, offset }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, dataSet, status, err },
          "Failed to list batches",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
