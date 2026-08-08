import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { CreateSchemaRequest, XdmSchema } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_schema";
const TOOL_DESCRIPTION =
  "Create a new XDM schema in the tenant container of the Adobe Experience Platform Schema Registry. " +
  "Extends a standard XDM class (e.g. Profile, ExperienceEvent) via classRef, and composes in zero or " +
  "more field groups via fieldGroupRefs.\n" +
  "\n" +
  "IMPORTANT: a schema built from a class alone carries only that class's base fields — it has NO " +
  "tenant-specific fields and is rarely useful on its own. Supply 'fieldGroupRefs' with the field " +
  "groups that actually carry your data (e.g. 'https://ns.adobe.com/xdm/context/profile-person-details'). " +
  "Field groups can also be added later with 'aep_update_schema'.\n" +
  "\n" +
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
  fieldGroupRefs: z
    .array(z.string().url())
    .optional()
    .describe(
      "Array of XDM field group $ref URIs to compose into the schema. Field groups are what give a " +
        "schema its actual fields. Example: " +
        "['https://ns.adobe.com/xdm/context/profile-person-details', " +
        "'https://ns.adobe.com/xdm/context/profile-personal-details']. " +
        "Omit ONLY if you intend a bare class-based schema with no additional fields.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Schemas",
        operation: "write",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { title, description, classRef, fieldGroupRefs } = args;

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            title,
            classRef,
            fieldGroupCount: fieldGroupRefs?.length ?? 0,
          },
          "Creating schema",
        );

        // XDM composition: `allOf` carries the class FIRST, then every field
        // group. Previously only the class was sent, so every schema this tool
        // created came back with no tenant fields at all.
        const body: CreateSchemaRequest = {
          title,
          description,
          type: "object",
          allOf: [
            { $ref: classRef },
            ...(fieldGroupRefs ?? []).map((ref) => ({ $ref: ref })),
          ],
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
          {
            tool: TOOL_NAME,
            schemaId: created.$id,
            title: created.title,
            fieldGroupCount: fieldGroupRefs?.length ?? 0,
          },
          "Schema created",
        );

        // Warn rather than silently succeed: a class-only schema is valid XDM
        // but has no tenant fields, and that is almost never what was wanted.
        if (!fieldGroupRefs || fieldGroupRefs.length === 0) {
          return toolResult({
            ...created,
            _warning:
              "Schema was created from a class with NO field groups, so it carries only the " +
              "class's base fields and no tenant-specific data fields. Add field groups with " +
              "'aep_update_schema' before creating a dataset from this schema.",
          });
        }

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
