import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { CreateSchemaRequest, XdmSchema } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_schema";
const TOOL_DESCRIPTION =
  "Create a new XDM schema in the tenant container of the Adobe Experience Platform Schema Registry. " +
  "Extends a standard XDM class (e.g. Profile, ExperienceEvent) via classRef. " +
  "Returns the created schema including its generated $id.";

const inputSchema = {
  title: z
    .string()
    .min(1)
    .max(255)
    .describe("Human-readable title for the schema (e.g. 'Loyalty Profile')"),
  description: z
    .string()
    .max(4096)
    .optional()
    .describe("Optional description of the schema's purpose"),
  classRef: z
    .string()
    .url()
    .describe(
      "The $ref URI of the XDM class to extend (e.g. 'https://ns.adobe.com/xdm/context/profile' or " +
        "'https://ns.adobe.com/xdm/context/experienceevent')",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Schemas",
        operation: "write",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { title, description, classRef } = args;

      try {
        logger.debug({ tool: TOOL_NAME, title, classRef }, "Creating schema");

        const body: CreateSchemaRequest = {
          title,
          description,
          type: "object",
          allOf: [{ $ref: classRef }],
        };

        const created = await ctx.client.request<XdmSchema>({
          method: "POST",
          path: "/data/foundation/schemaregistry/tenant/schemas",
          body,
          headers: {
            "Content-Type": "application/vnd.adobe.xed+json; version=1",
            Accept: "application/vnd.adobe.xed+json; version=1",
          },
        });

        logger.info(
          { tool: TOOL_NAME, schemaId: created.$id, title: created.title },
          "Schema created",
        );

        return toolResult(created);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, title, err },
          "Failed to create schema",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
