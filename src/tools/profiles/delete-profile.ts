import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const TOOL_NAME = "aep_delete_profile";
const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Permanently delete a unified profile from the Adobe Experience Platform Unified Profile " +
  "Service (UPS). This call immediately purges the profile entity from the Profile Store and triggers an " +
  "asynchronous privacy/GDPR job to remove related data across the platform. The deletion CANNOT be undone. " +
  "Use only for verified privacy/erasure requests (GDPR/CCPA). The response includes a JobId when one is " +
  "returned by UPS, which can be tracked via the Privacy Service.";

const inputSchema = {
  entityId: z
    .string()
    .min(1)
    .describe("The entity identifier value to delete (e.g. an ECID, email, or CRM ID)."),
  entityIdNS: z
    .string()
    .min(1)
    .describe("The namespace code for the entity ID (e.g. 'ECID', 'email', 'phone', 'CRMID')."),
};

interface DeleteProfileResponse {
  jobId?: string;
  JobId?: string;
  message?: string;
  status?: string;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(TOOL_NAME, TOOL_DESCRIPTION, inputSchema, async (args) => {
    const { entityId, entityIdNS } = args;

    try {
      logger.warn(
        { tool: TOOL_NAME, entityId, entityIdNS },
        "DESTRUCTIVE: deleting unified profile",
      );

      // Use request() directly because client.delete() doesn't accept query params,
      // and UPS requires entityId/entityIdNS as query string on the DELETE endpoint.
      const response = await ctx.client.request<DeleteProfileResponse | undefined>({
        method: "DELETE",
        path: "/data/core/ups/access/entities/",
        query: {
          entityId,
          entityIdNS,
        },
      });

      const jobId = response?.jobId ?? response?.JobId;
      const deletedAt = new Date().toISOString();

      logger.info(
        { tool: TOOL_NAME, entityId, entityIdNS, jobId, deletedAt },
        "Profile delete accepted by UPS",
      );

      return toolResult({
        success: true,
        entityId,
        entityIdNS,
        deletedAt,
        jobId,
        message:
          "Profile entity deletion accepted. UPS will purge the record and trigger a downstream " +
          "privacy job. Track jobId (if present) via the Privacy Service to confirm full erasure.",
        rawResponse: response ?? null,
      });
    } catch (err) {
      logger.error(
        { tool: TOOL_NAME, entityId, entityIdNS, err },
        "Failed to delete profile",
      );
      return toolError(mapApiError(err));
    }
  });
}
