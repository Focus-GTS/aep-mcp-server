import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";
import { datastreamPath } from "./paths.js";

const TOOL_NAME = "aep_delete_datastream";
const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Permanently delete an Adobe Experience Platform Edge Network datastream. " +
  "Once deleted, any Web SDK / Mobile SDK / Server SDK property still configured with this " +
  "datastream ID will stop forwarding events to Adobe services until it is re-pointed at " +
  "another datastream. This operation cannot be undone." +
  "ENDPOINT UNDOCUMENTED — LIVE VALIDATION PENDING. Adobe publishes no REST API for datastream configuration; this tool's path is not documentation-supported and has never been confirmed against a live tenant. Blocked on Adobe case SALES0855734. See docs/datastream-endpoint-investigation-2026-08-12.md.";

const inputSchema = {
  datastreamId: z
    .string()
    .min(1)
    .describe("The datastream ID to delete"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Datastreams",
        operation: "delete",
        destructive: true,
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { datastreamId } = args;

      logger.warn({ datastreamId }, "Deleting datastream");

      try {
        const encodedId = encodeURIComponent(datastreamId);

        await ctx.client.request<unknown>({
          method: "DELETE",
          path: datastreamPath(encodedId),
        });

        const deletedAt = new Date().toISOString();

        logger.info(
          { tool: TOOL_NAME, datastreamId, deletedAt },
          "Datastream deleted",
        );

        return toolResult({
          success: true,
          datastreamId,
          deletedAt,
          message: `Datastream '${datastreamId}' deleted.`,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datastreamId, err },
          "Failed to delete datastream",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
