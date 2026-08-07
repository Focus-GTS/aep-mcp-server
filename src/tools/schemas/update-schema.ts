import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { XdmSchema } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_update_schema";
const TOOL_DESCRIPTION =
  "Update an existing XDM schema in the Adobe Experience Platform Schema Registry using JSON Patch. " +
  "The most common use is ADDING FIELD GROUPS to a schema that was created without them — a schema " +
  "built from a class alone has no tenant-specific fields.\n" +
  "\n" +
  "Two ways to call this:\n" +
  "  1. 'addFieldGroupRefs' — convenience form. Appends each field group to the schema's allOf array.\n" +
  "  2. 'operations' — raw JSON Patch escape hatch for title/description edits or any operation the " +
  "convenience form doesn't cover.\n" +
  "\n" +
  "IMPORTANT CONSTRAINT: once a dataset has been created from a schema, XDM forbids breaking changes. " +
  "Adding field groups is additive and generally safe; removing fields or changing types is not, and " +
  "Adobe will reject those with a 400.";

const jsonPatchOp = z.object({
  op: z
    .enum(["add", "remove", "replace", "move", "copy", "test"])
    .describe("JSON Patch operation type (RFC 6902)"),
  path: z
    .string()
    .min(1)
    .describe("JSON Pointer path, e.g. '/allOf/-' to append or '/title' to replace"),
  value: z
    .unknown()
    .optional()
    .describe("Value for add/replace/test operations"),
});

const inputSchema = {
  schemaId: z
    .string()
    .min(1)
    .describe(
      "The schema's $id or meta:altId. Full URI ($id) form is recommended, e.g. " +
        "'https://ns.adobe.com/{tenant}/schemas/abc123...'",
    ),
  addFieldGroupRefs: z
    .array(z.string().url())
    .optional()
    .describe(
      "Convenience: field group $ref URIs to APPEND to the schema. Each becomes an " +
        "{ op:'add', path:'/allOf/-', value:{ $ref } } patch operation. " +
        "Example: ['https://ns.adobe.com/xdm/context/profile-person-details']",
    ),
  operations: z
    .array(jsonPatchOp)
    .optional()
    .describe(
      "Raw JSON Patch operations, applied AFTER any generated from 'addFieldGroupRefs'. " +
        "Use for title/description changes or anything the convenience form doesn't cover.",
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
      const { schemaId, addFieldGroupRefs, operations } = args;

      const patch: Array<{ op: string; path: string; value?: unknown }> = [
        ...(addFieldGroupRefs ?? []).map((ref) => ({
          op: "add",
          path: "/allOf/-",
          value: { $ref: ref },
        })),
        ...(operations ?? []),
      ];

      if (patch.length === 0) {
        return toolError({
          code: "INVALID_INPUT",
          message:
            "Nothing to update. Provide 'addFieldGroupRefs', 'operations', or both.",
        });
      }

      try {
        logger.info(
          {
            tool: TOOL_NAME,
            schemaId,
            operationCount: patch.length,
            fieldGroupsAdded: addFieldGroupRefs?.length ?? 0,
          },
          "Updating schema",
        );

        // Schema IDs are full URIs; they must be URL-encoded as a path segment.
        const encodedId = encodeURIComponent(schemaId);

        const updated = await ctx.client.request<XdmSchema>({
          method: "PATCH",
          path: `/data/foundation/schemaregistry/tenant/schemas/${encodedId}`,
          body: patch,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/vnd.adobe.xed+json; version=1",
          },
        });

        logger.info(
          { tool: TOOL_NAME, schemaId, title: updated.title },
          "Schema updated",
        );

        return toolResult(updated);
      } catch (err) {
        logger.error({ tool: TOOL_NAME, schemaId, err }, "Failed to update schema");
        return toolError(mapApiError(err));
      }
    },
  );
}
