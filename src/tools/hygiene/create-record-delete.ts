import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { WorkOrder } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_record_delete";
const CONFIRMATION_PHRASE = "I understand this is irreversible";
const ALL_DATASETS = "ALL";

const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Submit a record delete work order to the Adobe Experience Platform Data Hygiene " +
  "(Data Lifecycle) API. The work order permanently deletes every record matching the supplied " +
  "identities from a single dataset, or from EVERY dataset in the sandbox when datasetId is 'ALL'. " +
  "Deletion is asynchronous and CANNOT be undone — poll aep_get_work_order_status to follow it.\n" +
  "\n" +
  "This is Adobe's sanctioned replacement for the deprecated Unified Profile Service " +
  "delete-entity endpoint wrapped by aep_delete_profile. Prefer this tool for all new " +
  "record-deletion work.\n" +
  "\n" +
  "REQUIRED CONFIRMATION: callers MUST pass the 'confirm' input set to the EXACT literal string " +
  `'${CONFIRMATION_PHRASE}'. Any other value, or omitting the field, rejects the call BEFORE any ` +
  "API call is made.\n" +
  "\n" +
  "Requires the Data Distiller / Data Hygiene entitlement. Record deletes are subject to Adobe's " +
  "quota on work orders per sandbox per month.\n" +
  "\n" +
  "NOTE: this endpoint shape comes from Adobe's published Data Lifecycle API documentation and has " +
  "not been exercised against a live sandbox — validate the path and request body against your own " +
  "sandbox before relying on it in production.";

const inputSchema = {
  datasetId: z
    .string()
    .min(1)
    .describe(
      `The dataset to delete records from. Pass the literal '${ALL_DATASETS}' to delete the ` +
        "identities from every dataset in the sandbox — this is the widest possible blast radius, " +
        "so only use it for verified erasure requests.",
    ),
  identities: z
    .array(
      z.object({
        namespace: z
          .string()
          .min(1)
          .describe(
            "Identity namespace code for the ID (e.g. 'ECID', 'email', 'phone', 'CRMID'). " +
              "Must be a namespace registered in the sandbox.",
          ),
        id: z
          .string()
          .min(1)
          .describe(
            "The identity value to delete (e.g. the ECID, email address, or CRM ID itself).",
          ),
      }),
    )
    .min(1)
    .describe(
      "One or more identities whose records should be deleted. Every record in scope that " +
        "carries any of these identities is permanently removed.",
    ),
  displayName: z
    .string()
    .optional()
    .describe(
      "Optional human-readable name for the work order, shown in the Data Hygiene UI.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Optional free-text description of why the deletion was requested (e.g. a DSR ticket ID).",
    ),
  confirm: z
    .string()
    .describe(
      `REQUIRED confirmation gate. Must equal the EXACT literal string: '${CONFIRMATION_PHRASE}'. ` +
        "Any other value rejects the request without making the API call.",
    ),
};

interface CreateWorkOrderResponse extends WorkOrder {
  workorderId?: string;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Data Hygiene",
        operation: "delete",
        requiresEntitlement: "Data Distiller / Data Hygiene",
        destructive: true,
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { datasetId, identities, displayName, description, confirm } = args;

      if (confirm !== CONFIRMATION_PHRASE) {
        logger.warn(
          {
            tool: TOOL_NAME,
            datasetId,
            identityCount: identities.length,
            confirmProvided: Boolean(confirm),
          },
          "Record delete rejected: confirmation phrase missing or incorrect",
        );
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message:
            "Record deletion is destructive and requires explicit confirmation. " +
            `Re-invoke the tool with confirm='${CONFIRMATION_PHRASE}' (exact string match).`,
        });
      }

      try {
        logger.warn(
          {
            tool: TOOL_NAME,
            datasetId,
            identityCount: identities.length,
            allDatasets: datasetId === ALL_DATASETS,
          },
          "DESTRUCTIVE: submitting record delete work order (confirmation verified)",
        );

        const body: Record<string, unknown> = {
          action: "delete_identity",
          datasetId,
          identities,
        };
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;

        const response = await ctx.client.post<
          CreateWorkOrderResponse | undefined
        >("/data/core/hygiene/workorder", body);

        const workorderId = response?.workorderId;
        const submittedAt = new Date().toISOString();

        logger.info(
          { tool: TOOL_NAME, datasetId, workorderId, submittedAt },
          "Record delete work order accepted",
        );

        return toolResult({
          success: true,
          workorderId,
          datasetId,
          identityCount: identities.length,
          submittedAt,
          status: response?.status,
          message:
            "Record delete work order accepted. Deletion is asynchronous — poll " +
            "aep_get_work_order_status with the workorderId to track completion.",
          rawResponse: response ?? null,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datasetId, err },
          "Failed to submit record delete work order",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
