import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { IdentityNamespace } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_list_identity_namespaces";
const TOOL_DESCRIPTION =
  "List identity namespaces registered in the Adobe Experience Platform Identity Service. " +
  "Returns both standard (ECID, email, phone, etc.) and custom namespaces for the tenant. " +
  "Use the optional 'custom' flag to filter to only tenant-defined custom namespaces.";

const inputSchema = {
  ...paginationSchema,
  custom: z
    .boolean()
    .optional()
    .describe(
      "If true, return only custom (tenant-defined) namespaces. If false or omitted, return all namespaces.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Identities",
        operation: "read",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { limit, offset, custom } = args;

      try {
        logger.debug(
          { tool: TOOL_NAME, limit, offset, custom },
          "Listing identity namespaces",
        );

        // The Identity Service returns a flat array of namespaces (not paginated server-side),
        // so we apply offset/limit/filter client-side for a consistent paginated response.
        const response = await ctx.client.request<IdentityNamespace[]>({
          method: "GET",
          path: "/data/core/idnamespace/identities",
        });

        const all = Array.isArray(response) ? response : [];
        const filtered =
          custom === true ? all.filter((ns) => ns.custom === true) : all;

        const page = filtered.slice(offset, offset + limit);

        return toolResult(
          buildPaginatedResponse<IdentityNamespace>(page, filtered.length, {
            limit,
            offset,
          }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to list identity namespaces",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
