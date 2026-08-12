import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Datastream } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";
import { DATASTREAMS_BASE_PATH } from "./paths.js";

const TOOL_NAME = "aep_create_datastream";
const TOOL_DESCRIPTION =
  "Create a new Adobe Experience Platform Edge Network datastream. A datastream is the " +
  "configuration object that tells the Edge Network which Adobe services (AJO, Target, " +
  "Analytics, AEP, Audience Manager) should receive events from a given Web SDK / Mobile SDK / " +
  "Server SDK property. Returns the created datastream including its server-assigned ID." +
  "ENDPOINT UNDOCUMENTED — LIVE VALIDATION PENDING. Adobe publishes no REST API for datastream configuration; this tool's path is not documentation-supported and has never been confirmed against a live tenant. Blocked on Adobe case SALES0855734. See docs/datastream-endpoint-investigation-2026-08-12.md.";

const inputSchema = {
  name: z
    .string()
    .min(1)
    .describe("Human-readable datastream name"),
  description: z
    .string()
    .optional()
    .describe("Optional description of the datastream purpose"),
  config: z
    .record(z.unknown())
    .describe(
      "Datastream config — deeply nested Adobe object specifying services (AJO, Target, " +
        "Analytics, AEP), event forwarding, identity overrides, etc. See " +
        "https://experienceleague.adobe.com/docs/experience-platform/datastreams/configure.html " +
        "for the current shape.",
    ),
};

interface DatastreamCreateResponse {
  data?: Datastream;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Datastreams",
        operation: "write",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { name, description, config } = args;

      try {
        logger.info(
          { tool: TOOL_NAME, name },
          "Creating datastream",
        );

        const body: Record<string, unknown> = {
          name,
          config,
        };
        if (description !== undefined) {
          body.description = description;
        }

        const response = await ctx.client.request<
          DatastreamCreateResponse | Datastream
        >({
          method: "POST",
          path: DATASTREAMS_BASE_PATH,
          body,
        });

        const created: Datastream =
          response && typeof response === "object" && "data" in response
            ? ((response as DatastreamCreateResponse).data as Datastream)
            : (response as Datastream);

        logger.info(
          { tool: TOOL_NAME, datastreamId: created?.id, name: created?.name },
          "Datastream created",
        );

        return toolResult(created);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, name, err },
          "Failed to create datastream",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
