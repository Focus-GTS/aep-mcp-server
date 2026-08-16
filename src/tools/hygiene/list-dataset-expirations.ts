import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { DatasetExpiration } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_dataset_expirations";
const TOOL_DESCRIPTION =
  "List the dataset expirations (TTLs) configured in the current sandbox via the Adobe " +
  "Experience Platform Data Hygiene API. Each entry shows the dataset, the ISO 8601 timestamp at " +
  "which it is scheduled for deletion, and the current status of that schedule.\n" +
  "\n" +
  "Use this to audit which datasets are on a delete clock before data disappears, and to recover " +
  "the datasetId needed to change or extend a TTL with aep_create_dataset_expiration.\n" +
  "\n" +
  "NOTE: this endpoint shape comes from Adobe's published Data Lifecycle API documentation and has " +
  "not been exercised against a live sandbox — validate the path and query parameters against your " +
  "own sandbox before relying on it in production.";

const inputSchema = {
  ...paginationSchema,
  datasetId: z
    .string()
    .optional()
    .describe(
      "Optional dataset ID filter. Omit to return every configured expiration in the sandbox.",
    ),
  status: z
    .string()
    .optional()
    .describe(
      "Optional status filter (e.g. 'pending', 'executing', 'cancelled'). " +
        "Omit to return expirations in every status.",
    ),
};

interface ExpirationListResponse {
  results?: DatasetExpiration[];
  children?: DatasetExpiration[];
  data?: DatasetExpiration[];
  _page?: { count?: number; limit?: number; start?: number };
  [key: string]: unknown;
}

function extractExpirations(
  response: ExpirationListResponse | DatasetExpiration[] | undefined,
): DatasetExpiration[] {
  if (Array.isArray(response)) return response;
  if (!response) return [];
  // Adobe's Data Hygiene API has shipped `results`, `children`, and `data`
  // envelopes across revisions; accept whichever one is present.
  return response.results ?? response.children ?? response.data ?? [];
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Data Hygiene",
        operation: "read",
        requiresEntitlement: "Data Hygiene",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { limit, offset, datasetId, status } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, limit, offset, datasetId, status },
          "Listing dataset expirations",
        );

        const response = await ctx.client.request<
          ExpirationListResponse | DatasetExpiration[]
        >({
          method: "GET",
          path: "/data/core/hygiene/ttl",
          query: {
            start: offset,
            limit,
            datasetId,
            status,
          },
        });

        const results = extractExpirations(response);

        logger.info(
          { tool: TOOL_NAME, count: results.length },
          "Dataset expirations listed",
        );

        return toolResult(
          buildPaginatedResponse<DatasetExpiration>(results, { limit, offset }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list dataset expirations",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
