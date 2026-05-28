import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Dataset } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { paginationSchema, buildPaginatedResponse } from "../../util/pagination.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_list_datasets";
const TOOL_DESCRIPTION =
  "List datasets from the Adobe Experience Platform Catalog. Supports filtering by name " +
  "(contains-match) and state. Returns a paginated array of datasets keyed by id.";

const inputSchema = {
  ...paginationSchema,
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Optional case-sensitive contains-match filter on dataset name"),
  state: z
    .enum(["DRAFT", "ENABLED", "DISABLED"])
    .optional()
    .describe("Optional filter for dataset state"),
};

type DatasetMap = Record<string, Omit<Dataset, "id">>;
type DatasetWithId = Dataset & { id: string };

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { limit, offset, name, state } = args;

    try {
      logger.debug({ tool: TOOL_NAME, limit, offset, name, state }, "Listing datasets");

      const response = await ctx.client.get<DatasetMap>(
        "/data/foundation/catalog/dataSets",
        {
          limit,
          start: offset,
          name,
          state,
        },
      );

      // Catalog returns a map keyed by dataset ID. Convert to an array shape
      // with the id surfaced as a property for easier downstream consumption.
      const results: DatasetWithId[] = Object.entries(response ?? {}).map(
        ([id, dataset]) => ({ id, ...dataset } as DatasetWithId),
      );

      // The Catalog API doesn't return a total count, so we infer from the
      // current window — hasMore is true if the page is full.
      const total = offset + results.length + (results.length === limit ? 1 : 0);

      return toolResult(
        buildPaginatedResponse<DatasetWithId>(results, total, { limit, offset }),
      );
    } catch (err) {
      logger.error({ tool: TOOL_NAME, err }, "Failed to list datasets");
      return toolError(mapApiError(err));
    }
  });
}
