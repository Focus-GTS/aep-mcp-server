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
  "EXPERIMENTAL — UNSUPPORTED ENDPOINT. Adobe publishes no REST API for datastream configuration, and on 2026-08-14 this path returned an HTML 404 from a sandbox where every other AEP surface worked — so the route does not exist as called. This is not a permissions problem. Do not rely on this tool; it is retained only so the path can be re-probed if Adobe publishes or confirms an API. See issue docs/issues/001-datastream-api-documentation-gap.md.";

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
