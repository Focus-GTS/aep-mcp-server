import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { WorkOrder } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_work_orders";
const TOOL_DESCRIPTION =
  "List Adobe Experience Platform Data Hygiene work orders for the current sandbox. Work orders " +
  "are the asynchronous record-delete jobs created by aep_create_record_delete. Returns a " +
  "paginated list with each work order's ID, action, target dataset, status, and timestamps.\n" +
  "\n" +
  "Use this to audit what deletions have been requested in a sandbox, or to recover a workorderId " +
  "for aep_get_work_order_status.\n" +
  "\n" +
  "NOTE: this endpoint shape comes from Adobe's published Data Lifecycle API documentation and has " +
  "not been exercised against a live sandbox — validate the path and query parameters against your " +
  "own sandbox before relying on it in production.";

const inputSchema = {
  ...paginationSchema,
  status: z
    .string()
    .optional()
    .describe(
      "Optional status filter (e.g. 'received', 'processing', 'completed', 'failed'). " +
        "Omit to return work orders in every status.",
    ),
  action: z
    .string()
    .optional()
    .describe(
      "Optional action filter (e.g. 'delete_identity', 'delete_dataset'). " +
        "Omit to return work orders for every action.",
    ),
};

interface WorkOrderListResponse {
  results?: WorkOrder[];
  children?: WorkOrder[];
  data?: WorkOrder[];
  _page?: { count?: number; limit?: number; start?: number };
  [key: string]: unknown;
}

function extractWorkOrders(
  response: WorkOrderListResponse | WorkOrder[] | undefined,
): WorkOrder[] {
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
      const { limit, offset, status, action } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, limit, offset, status, action },
          "Listing Data Hygiene work orders",
        );

        const response = await ctx.client.request<
          WorkOrderListResponse | WorkOrder[]
        >({
          method: "GET",
          path: "/data/core/hygiene/workorder",
          query: {
            start: offset,
            limit,
            status,
            action,
          },
        });

        const results = extractWorkOrders(response);

        logger.info(
          { tool: TOOL_NAME, count: results.length },
          "Data Hygiene work orders listed",
        );

        return toolResult(
          buildPaginatedResponse<WorkOrder>(results, { limit, offset }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list Data Hygiene work orders",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
