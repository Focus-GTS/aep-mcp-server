import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { WorkOrder } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_work_order_status";
const TOOL_DESCRIPTION =
  "Get the current status of an Adobe Experience Platform Data Hygiene work order — the " +
  "asynchronous job created by aep_create_record_delete. Returns the work order's status " +
  "(e.g. received, validating, processing, completed, failed), the dataset it targets, how many " +
  "records it covers, and per-product status details where Adobe reports them.\n" +
  "\n" +
  "Record deletes can take hours to reach 'completed'. Poll this tool rather than assuming a " +
  "submitted work order has already purged the data.\n" +
  "\n" +
  "NOTE: this endpoint shape comes from Adobe's published Data Lifecycle API documentation and has " +
  "not been exercised against a live sandbox — validate the path against your own sandbox before " +
  "relying on it in production.";

const inputSchema = {
  workorderId: z
    .string()
    .min(1)
    .describe(
      "The work order ID returned by aep_create_record_delete (or listed by aep_list_work_orders).",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Data Hygiene",
        operation: "read",
        requiresEntitlement: "Data Distiller / Data Hygiene",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { workorderId } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, workorderId },
          "Fetching work order status",
        );

        const encodedId = encodeURIComponent(workorderId);
        const response = await ctx.client.get<WorkOrder>(
          `/data/core/hygiene/workorder/${encodedId}`,
        );

        logger.info(
          { tool: TOOL_NAME, workorderId, status: response?.status },
          "Work order status retrieved",
        );

        return toolResult(response);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, workorderId, err },
          "Failed to get work order status",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
