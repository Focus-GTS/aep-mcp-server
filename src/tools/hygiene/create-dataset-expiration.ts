import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { DatasetExpiration } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_dataset_expiration";
const CONFIRMATION_PHRASE = "I understand this is irreversible";

const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Set a dataset expiration (TTL) on an Adobe Experience Platform dataset via the " +
  "Data Hygiene API. At the expiry timestamp Adobe permanently deletes the dataset and all of its " +
  "data — the deletion CANNOT be undone once it executes. Setting an expiration on a dataset that " +
  "already has one replaces the existing schedule.\n" +
  "\n" +
  "REQUIRED CONFIRMATION: callers MUST pass the 'confirm' input set to the EXACT literal string " +
  `'${CONFIRMATION_PHRASE}'. Any other value, or omitting the field, rejects the call BEFORE any ` +
  "API call is made.\n" +
  "\n" +
  "EXCEPTION: when 'dryRun' is true the confirmation is NOT required. A dry run asks Adobe to " +
  "validate the request and report what would happen without scheduling any deletion. Run a dry " +
  "run first to check the expiry is accepted before committing to it.\n" +
  "\n" +
  "Requires the Data Distiller / Data Hygiene entitlement.\n" +
  "\n" +
  "NOTE: this endpoint shape comes from Adobe's published Data Lifecycle API documentation and has " +
  "not been exercised against a live sandbox — validate the path, request body, and dryRun query " +
  "parameter against your own sandbox before relying on it in production.";

const inputSchema = {
  datasetId: z
    .string()
    .min(1)
    .describe(
      "The ID of the dataset to schedule for deletion. The whole dataset — not a subset of its " +
        "records — is deleted when the expiry is reached.",
    ),
  expiry: z
    .string()
    .datetime()
    .describe(
      "ISO 8601 timestamp at which the dataset should be deleted, e.g. '2027-01-01T00:00:00Z'. " +
        "Must be in the future; Adobe rejects past timestamps.",
    ),
  displayName: z
    .string()
    .optional()
    .describe(
      "Optional human-readable name for the expiration, shown in the Data Hygiene UI.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Optional free-text description of why the dataset is being expired (e.g. a retention policy ID).",
    ),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, validate the request without scheduling any deletion. Nothing is deleted and " +
        "the 'confirm' gate is skipped. Use this to check an expiry before committing to it.",
    ),
  confirm: z
    .string()
    .optional()
    .describe(
      `Confirmation gate required whenever dryRun is false. Must equal the EXACT literal string: ` +
        `'${CONFIRMATION_PHRASE}'. Any other value rejects the request without making the API call. ` +
        "Ignored when dryRun is true.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Experience Platform",
        category: "Data Hygiene",
        operation: "write",
        requiresEntitlement: "Data Distiller / Data Hygiene",
        destructive: true,
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { datasetId, expiry, displayName, description, dryRun, confirm } =
        args;

      // A dry run schedules nothing, so the confirmation gate only applies to
      // the real call.
      if (!dryRun && confirm !== CONFIRMATION_PHRASE) {
        logger.warn(
          {
            tool: TOOL_NAME,
            datasetId,
            expiry,
            confirmProvided: Boolean(confirm),
          },
          "Dataset expiration rejected: confirmation phrase missing or incorrect",
        );
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message:
            "Setting a dataset expiration schedules permanent deletion of the dataset and " +
            "requires explicit confirmation. Re-invoke the tool with " +
            `confirm='${CONFIRMATION_PHRASE}' (exact string match), or pass dryRun=true to ` +
            "validate the request without scheduling anything.",
        });
      }

      try {
        const log = dryRun ? logger.info.bind(logger) : logger.warn.bind(logger);
        log(
          { tool: TOOL_NAME, datasetId, expiry, dryRun },
          dryRun
            ? "Dry run: validating dataset expiration (nothing will be deleted)"
            : "DESTRUCTIVE: scheduling dataset expiration (confirmation verified)",
        );

        const body: Record<string, unknown> = { expiry };
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;

        const encodedId = encodeURIComponent(datasetId);

        // Use request() directly: client.put() does not accept query params and
        // the dryRun flag has to travel on the query string.
        const response = await ctx.client.request<DatasetExpiration | undefined>(
          {
            method: "PUT",
            path: `/data/core/hygiene/ttl/${encodedId}`,
            query: dryRun ? { dryRun: true } : undefined,
            body,
          },
        );

        logger.info(
          {
            tool: TOOL_NAME,
            datasetId,
            expiry,
            dryRun,
            ttlId: response?.ttlId,
            status: response?.status,
          },
          dryRun
            ? "Dataset expiration dry run complete"
            : "Dataset expiration scheduled",
        );

        return toolResult({
          success: true,
          dryRun,
          datasetId,
          expiry,
          ttlId: response?.ttlId,
          status: response?.status,
          message: dryRun
            ? "Dry run only — no expiration was scheduled and no data was deleted. Re-invoke " +
              `with dryRun=false and confirm='${CONFIRMATION_PHRASE}' to commit the schedule.`
            : "Dataset expiration scheduled. Adobe will permanently delete the dataset at the " +
              "expiry timestamp. Review it with aep_list_dataset_expirations.",
          rawResponse: response ?? null,
        });
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, datasetId, expiry, dryRun, err },
          "Failed to set dataset expiration",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
