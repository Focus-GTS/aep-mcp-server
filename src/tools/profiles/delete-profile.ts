import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_delete_profile";
const CONFIRMATION_PHRASE = "I understand this is irreversible";
const DEFAULT_SCHEMA_NAME = "_xdm.context.profile";

const TOOL_DESCRIPTION =
  "⚠️ DEPRECATED — PREFER 'aep_create_record_delete'.\n" +
  "\n" +
  "Adobe has publicly condemned the endpoint this tool wraps: \"The delete entity endpoint will be " +
  "deprecated by the end of October 2025. If you want to perform record delete operations, you can use " +
  "the Data Lifecycle record delete API workflow.\" As of the last documentation check (May 2026) the " +
  "endpoint still responds and Adobe has published no replacement sunset date — so this tool is retained " +
  "for tenants where it remains the working path. New integrations should use 'aep_create_record_delete', " +
  "which targets Adobe's sanctioned Data Lifecycle API.\n" +
  "\n" +
  "DESTRUCTIVE: Permanently deletes a unified profile from the Adobe Experience Platform Unified Profile " +
  "Service (UPS). This call immediately purges the profile entity from the Profile Store and triggers an " +
  "asynchronous privacy/GDPR job to remove related data across the platform. The deletion CANNOT be undone. " +
  "Use only for verified privacy/erasure requests (GDPR/CCPA).\n" +
  "\n" +
  "REQUIRED CONFIRMATION: callers MUST pass the 'confirm' input set to the EXACT literal string " +
  `'${CONFIRMATION_PHRASE}'. Any other value, or omitting the field, will reject the call BEFORE any ` +
  "API call is made.\n" +
  "\n" +
  "The response includes a JobId when one is returned by UPS, which can be tracked via the Privacy Service.";

const inputSchema = {
  entityId: z
    .string()
    .min(1)
    .describe(
      "The entity identifier value to delete (e.g. an ECID, email, or CRM ID).",
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
    .optional()
    .describe(
      `XDM schema class name for the entity. Defaults to '${DEFAULT_SCHEMA_NAME}'. ` +
        "Override only when deleting non-profile entities (e.g. ExperienceEvents).",
    ),
  confirm: z
    .string()
    .describe(
      `REQUIRED confirmation gate. Must equal the EXACT literal string: '${CONFIRMATION_PHRASE}'. ` +
        "Any other value rejects the request without making the API call.",
    ),
};

interface DeleteProfileResponse {
  jobId?: string;
  JobId?: string;
  message?: string;
  status?: string;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Profiles",
        operation: "delete",
        requiresEntitlement: "Real-Time CDP",
        destructive: true,
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { entityId, entityIdNS, schemaName, confirm } = args;

      if (confirm !== CONFIRMATION_PHRASE) {
        logger.warn(
          {
            tool: TOOL_NAME,
            entityId,
            entityIdNS,
            confirmProvided: Boolean(confirm),
          },
          "Profile delete rejected: confirmation phrase missing or incorrect",
        );
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message:
            `Profile deletion is destructive and requires explicit confirmation. ` +
            `Re-invoke the tool with confirm='${CONFIRMATION_PHRASE}' (exact string match).`,
        });
      }

      const effectiveSchemaName = schemaName ?? DEFAULT_SCHEMA_NAME;

      try {
        logger.warn(
          {
            tool: TOOL_NAME,
            entityId,
            entityIdNS,
            schemaName: effectiveSchemaName,
          },
          "DESTRUCTIVE: deleting unified profile (confirmation verified)",
        );

        // Use request() directly: client.delete() does not accept query params,
        // and UPS requires entityId/entityIdNS/schema.name on the DELETE query string.
        // Path has NO trailing slash — the trailing slash variant 404s.
        const response = await ctx.client.request<
          DeleteProfileResponse | undefined
        >({
          method: "DELETE",
          path: "/data/core/ups/access/entities",
          query: {
            entityId,
            entityIdNS,
            "schema.name": effectiveSchemaName,
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
          schemaName: effectiveSchemaName,
          deletedAt,
          jobId,
          deprecated: true,
          message:
            "Profile entity deletion accepted. UPS will purge the record and trigger a downstream " +
            "privacy job. Track jobId (if present) via the Privacy Service to confirm full erasure.",
          _deprecationNotice:
            "This tool wraps an endpoint Adobe has deprecated in favour of the Data Lifecycle API. " +
            "Migrate to 'aep_create_record_delete' for new integrations.",
          rawResponse: response ?? null,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, entityId, entityIdNS, err },
          "Failed to delete profile",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
