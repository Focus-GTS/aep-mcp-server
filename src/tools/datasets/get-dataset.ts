import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Dataset } from "../../types/aep.js";
import {
  toolResult,
  toolError,
  mapApiError,
  AepApiError,
} from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_dataset";
const TOOL_DESCRIPTION =
  "Get a single dataset by ID from the Adobe Experience Platform Catalog. " +
  "Returns the full dataset definition including schema reference, tags, and file descriptor.";

const inputSchema = {
  datasetId: z
    .string()
    .min(1)
    .describe("The dataset ID (e.g. '5e8c91e8c4f9a818a8b3a5e1')"),
};

type DatasetMap = Record<string, Omit<Dataset, "id">>;
type DatasetWithId = Dataset & { id: string };

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Datasets",
        operation: "read",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { datasetId } = args;

      try {
        logger.debug({ tool: TOOL_NAME, datasetId }, "Fetching dataset");

        const response = await ctx.client.get<DatasetMap>(
          `/data/foundation/catalog/dataSets/${encodeURIComponent(datasetId)}`,
        );

        // The Catalog API returns a single-key map keyed by the dataset ID,
        // even for a single-item GET. Extract and flatten.
        const entries = Object.entries(response ?? {});
        if (entries.length === 0) {
          throw new AepApiError(
            404,
            { datasetId },
            `Dataset not found: ${datasetId}`,
          );
        }

        const [id, dataset] = entries[0];
        const result: DatasetWithId = { id, ...dataset } as DatasetWithId;

        return toolResult(result);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datasetId, err },
          "Failed to fetch dataset",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
