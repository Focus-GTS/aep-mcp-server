import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { ProfileEntity } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_profile_by_identity";
const TOOL_DESCRIPTION =
  "Retrieve a unified customer profile from the Adobe Experience Platform Real-Time Customer Profile " +
  "service using any known identity (email, ECID, phone, CRM ID, etc.) and its namespace. " +
  "Returns the merged profile including attributes, identity graph, consent, and segment membership.";

const inputSchema = {
  identityValue: z
    .string()
    .min(1)
    .describe(
      "The identity value to look up the profile by (e.g. 'user@example.com', an ECID, a CRM ID).",
    ),
  namespaceCode: z
    .string()
    .min(1)
    .describe(
      "The namespace code for the provided identity value (e.g. 'email', 'ECID', 'phone', 'CRMID').",
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
      const { identityValue, namespaceCode } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, identityValue, namespaceCode },
          "Fetching profile by identity",
        );

        const profile = await ctx.client.request<ProfileEntity>({
          method: "GET",
          path: "/data/core/ups/access/entities",
          query: {
            "schema.name": "_xdm.context.profile",
            entityId: identityValue,
            entityIdNS: namespaceCode,
          },
        });

        return toolResult(profile);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, identityValue, namespaceCode, err },
          "Failed to fetch profile by identity",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
