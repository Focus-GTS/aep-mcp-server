import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Datastream } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_datastream";
const TOOL_DESCRIPTION =
  "Get a single Adobe Experience Platform Edge Network datastream by ID. " +
  "Returns the full datastream object including name, description, and the deeply nested " +
  "`config` payload that lists every Adobe service the datastream forwards events to " +
  "(AJO, Target, Analytics, AEP, Audience Manager, event forwarding, identity overrides, etc.). " +
  "Use this before calling aep_update_datastream — PUT is a full replacement, so the existing " +
  "config must be read first and merged.";

const inputSchema = {
  datastreamId: z
    .string()
    .min(1)
    .describe("The datastream ID to retrieve"),
};

interface DatastreamGetResponse {
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
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { datastreamId } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, datastreamId },
          "Fetching datastream",
        );

        // Datastream IDs are URL-encoded as a path segment in case they
        // contain characters that need escaping.
        const encodedId = encodeURIComponent(datastreamId);

        const response = await ctx.client.request<
          DatastreamGetResponse | Datastream
        >({
          method: "GET",
          path: `/data/core/edge/datastreams/${encodedId}`,
        });

        // Adobe's Data Collection API wraps single-item responses in { data: ... }
        // in some versions and returns the bare object in others. Handle both.
        const datastream: Datastream =
          response && typeof response === "object" && "data" in response
            ? ((response as DatastreamGetResponse).data as Datastream)
            : (response as Datastream);

        logger.info(
          { tool: TOOL_NAME, datastreamId, name: datastream?.name },
          "Datastream fetched",
        );

        return toolResult(datastream);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datastreamId, err },
          "Failed to fetch datastream",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
