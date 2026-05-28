import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { ProfileEntity, ProfilePreview } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_preview_profile";
const TOOL_DESCRIPTION =
  "Get an abbreviated preview of a unified profile from the Adobe Experience Platform Unified Profile " +
  "Service (UPS). Returns only the requested XDM field paths (e.g. 'person.name', 'person.email', " +
  "'segmentMembership') to minimize payload size. If no fields are specified, returns only top-level " +
  "profile attributes (no nested objects).";

const inputSchema = {
  entityId: z
    .string()
    .min(1)
    .describe(
      "The entity identifier value (e.g. an ECID, email address, or CRM ID).",
    ),
  entityIdNS: z
    .string()
    .min(1)
    .describe("The namespace code for the entity ID (e.g. 'ECID', 'email')."),
  fields: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional list of XDM field paths to return (e.g. ['person.name', 'person.email', " +
        "'segmentMembership']). If omitted, returns only top-level attributes.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Profiles",
        operation: "read",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { entityId, entityIdNS, fields } = args;

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            entityId,
            entityIdNS,
            fieldCount: fields?.length ?? 0,
          },
          "Previewing profile",
        );

        // AEP UPS accepts `fields` as a comma-separated string of XDM paths.
        const fieldsParam =
          fields && fields.length > 0 ? fields.join(",") : undefined;

        const profile = await ctx.client.request<ProfileEntity>({
          method: "GET",
          path: "/data/core/ups/access/entities",
          query: {
            "schema.name": "_xdm.context.profile",
            entityId,
            entityIdNS,
            fields: fieldsParam,
          },
        });

        // If the caller asked for specific fields, return UPS's response as-is.
        // Otherwise, project to a top-level-only preview to keep the payload small.
        let projected: Record<string, unknown> = profile.entity ?? {};
        if (!fieldsParam) {
          projected = Object.fromEntries(
            Object.entries(profile.entity ?? {}).filter(
              ([, v]) => v === null || typeof v !== "object",
            ),
          );
        }

        const preview: ProfilePreview = {
          entityId: profile.entityId ?? entityId,
          profile: projected,
          identities: profile.identityGraph,
          segments: profile.segmentMembership
            ? Object.values(profile.segmentMembership).flatMap((bucket) =>
                Object.keys(bucket),
              )
            : undefined,
        };

        return toolResult(preview);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, entityId, entityIdNS, err },
          "Failed to preview profile",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
