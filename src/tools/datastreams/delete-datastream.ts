import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_delete_datastream";
const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Permanently delete an Adobe Experience Platform Edge Network datastream. " +
  "Once deleted, any Web SDK / Mobile SDK / Server SDK property still configured with this " +
  "datastream ID will stop forwarding events to Adobe services until it is re-pointed at " +
  "another datastream. This operation cannot be undone.";

const inputSchema = {
  datastreamId: z
    .string()
    .min(1)
    .describe("The datastream ID to delete"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Datastreams",
        operation: "delete",
        destructive: true,
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { datastreamId } = args;

      logger.warn({ datastreamId }, "Deleting datastream");

      try {
        const encodedId = encodeURIComponent(datastreamId);

        await ctx.client.request<unknown>({
          method: "DELETE",
          path: `/data/core/edge/datastreams/${encodedId}`,
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
