import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { IdentityGraph } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_get_identity_graph";
const TOOL_DESCRIPTION =
  "Retrieve the identity graph (cluster) for a given identity from the Adobe Experience Platform " +
  "Identity Service. Returns all linked identities across namespaces (ECID, email, phone, CRM ID, etc.) " +
  "that resolve to the same person/entity. Provide the identity value and either a namespace code " +
  "(e.g. 'ECID', 'email', 'phone') or a numeric namespace ID. If neither is provided, the namespace " +
  "code defaults to 'ECID'.";

const inputSchema = {
  identityValue: z
    .string()
    .min(1)
    .describe(
      "The identity value to look up (e.g. an ECID like '12345678901234567890', an email address, or a CRM ID).",
    ),
  namespaceCode: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Namespace code for the identity (e.g. 'ECID', 'email', 'phone', 'CRMID'). " +
        "Defaults to 'ECID' if neither namespaceCode nor namespaceId is supplied.",
    ),
  namespaceId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Numeric namespace ID (alternative to namespaceCode). If both are provided, namespaceId takes precedence.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Identities",
        operation: "read",
        requiresEntitlement: "Identity Service / Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { identityValue, namespaceCode, namespaceId } = args;

      // Always require a namespace param to be sent. If neither is provided,
      // default the namespaceCode to 'ECID' so the request is always well-formed.
      const effectiveNamespaceCode =
        namespaceId === undefined ? (namespaceCode ?? "ECID") : undefined;

      try {
        logger.debug(
          {
            tool: TOOL_NAME,
            identityValue,
            namespaceCode: effectiveNamespaceCode,
            namespaceId,
          },
          "Fetching identity graph",
        );

        // Build query params. Adobe expects 'nsId' (camelCase, capital I) for the
        // numeric namespace id, NOT 'nsid'. The previous lowercase form silently
        // failed because the service ignored it.
        const query: Record<string, string | number | undefined> = {
          id: identityValue,
        };

        if (namespaceId !== undefined) {
          query.nsId = namespaceId;
        } else {
          query.ns = effectiveNamespaceCode;
        }

        const graph = await ctx.client.request<IdentityGraph>({
          method: "GET",
          path: "/data/core/identity/cluster/members",
          query,
        });

        return toolResult(graph);
      } catch (err) {
        logger.error(
          {
            tool: TOOL_NAME,
            identityValue,
            namespaceCode: effectiveNamespaceCode,
            namespaceId,
            err,
          },
          "Failed to fetch identity graph",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
