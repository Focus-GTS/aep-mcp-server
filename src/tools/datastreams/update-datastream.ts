import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Datastream } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_update_datastream";
const TOOL_DESCRIPTION =
  "Update an existing Adobe Experience Platform Edge Network datastream. " +
  "PUT is a FULL replacement. Read the existing datastream with aep_get_datastream first " +
  "and merge changes into the full config before calling this tool — fields that are omitted " +
  "from the request body will be removed from the datastream. Returns the updated datastream.";

const inputSchema = {
  datastreamId: z
    .string()
    .min(1)
    .describe("The datastream ID to update"),
  name: z
    .string()
    .min(1)
    .describe("Updated name — required because PUT is a full replacement"),
  description: z
    .string()
    .optional()
    .describe("Updated description (omit to clear)"),
  config: z
    .record(z.unknown())
    .describe(
      "Updated full datastream config — PUT replaces the entire object, so include all " +
        "fields. Read with aep_get_datastream first if you only want to change part of it.",
    ),
};

interface DatastreamUpdateResponse {
  data?: Datastream;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Datastreams",
        operation: "write",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { datastreamId, name, description, config } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, datastreamId, name },
          "Updating datastream (full PUT replacement)",
        );

        const encodedId = encodeURIComponent(datastreamId);

        const body: Record<string, unknown> = {
          name,
          config,
        };
        if (description !== undefined) {
          body.description = description;
        }

        const response = await ctx.client.request<
          DatastreamUpdateResponse | Datastream
        >({
          method: "PUT",
          path: `/data/core/edge/datastreams/${encodedId}`,
          body,
        });

        const updated: Datastream =
          response && typeof response === "object" && "data" in response
            ? ((response as DatastreamUpdateResponse).data as Datastream)
            : (response as Datastream);

        logger.info(
          {
            tool: TOOL_NAME,
            datastreamId: updated?.id ?? datastreamId,
            name: updated?.name,
          },
          "Datastream updated",
        );

        return toolResult(updated);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datastreamId, err },
          "Failed to update datastream",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
