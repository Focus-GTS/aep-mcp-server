import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { ProfileEntity } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_profile";
const TOOL_DESCRIPTION =
  "Get the full unified profile entity from the Adobe Experience Platform Unified Profile Service (UPS). " +
  "Returns the merged record including XDM attributes, identity graph, consent, and segment membership. " +
  "Use a more specific schema name if you need a non-default XDM class (defaults to '_xdm.context.profile').";

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
    .describe(
      "The namespace code for the entity ID (e.g. 'ECID', 'email', 'phone', 'CRMID').",
    ),
  schemaName: z
    .string()
    .min(1)
    .default("_xdm.context.profile")
    .describe(
      "XDM schema class name for the entity. Defaults to '_xdm.context.profile' for individual profiles.",
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
      const { entityId, entityIdNS, schemaName } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, entityId, entityIdNS, schemaName },
          "Fetching profile entity",
        );

        const profile = await ctx.client.request<ProfileEntity>({
          method: "GET",
          path: "/data/core/ups/access/entities",
          query: {
            "schema.name": schemaName,
            entityId,
            entityIdNS,
          },
        });

        return toolResult(profile);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, entityId, entityIdNS, schemaName, err },
          "Failed to fetch profile entity",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
