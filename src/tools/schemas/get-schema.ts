import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { XdmSchema } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_get_schema";
const TOOL_DESCRIPTION =
  "Get the full XDM schema definition by its $id (or meta:altId) from the Adobe Experience Platform " +
  "Schema Registry. Returns the resolved schema including allOf composition, properties, and meta fields.";

const inputSchema = {
  schemaId: z
    .string()
    .min(1)
    .describe(
      "The schema $id URI (e.g. 'https://ns.adobe.com/tenant/schemas/abc123') or meta:altId",
    ),
  containerType: z
    .enum(["tenant", "global"])
    .default("tenant")
    .describe("Container holding the schema: 'tenant' or 'global'"),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { schemaId, containerType } = args;

    try {
      logger.debug({ tool: TOOL_NAME, schemaId, containerType }, "Fetching schema");

      // Schema IDs in AEP are URIs and must be URL-encoded as a path segment.
      const encodedId = encodeURIComponent(schemaId);

      const schema = await ctx.client.request<XdmSchema>({
        method: "GET",
        path: `/data/foundation/schemaregistry/${containerType}/schemas/${encodedId}`,
        headers: {
          Accept: "application/vnd.adobe.xed+json; version=1",
        },
      });

      return toolResult(schema);
    } catch (err) {
      logger.error({ tool: TOOL_NAME, schemaId, err }, "Failed to fetch schema");
      return toolError(mapApiError(err));
    }
  });
}
