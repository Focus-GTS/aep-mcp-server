import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { DatasetExpiration } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

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
  "EXCEPTION: when 'dryRun' is true the confirmation is NOT required, because nothing is sent. " +
  "IMPORTANT: Adobe does NOT document a dry-run mode for dataset expiration. dryRun here is a " +
  "purely LOCAL preview — it returns the exact request that would be sent and contacts Adobe not " +
  "at all. It confirms request SHAPE only; it does not confirm Adobe would accept it.\n" +
  "\n" +
  "Uses POST /data/core/hygiene/ttl with datasetId in the body, per Adobe's published API.\n" +
  "\n" +
  "NOT YET LIVE-VALIDATED: the request shape follows Adobe's documentation but no expiration has " +
  "been created against a live tenant from this tool.";

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
      "When true, return the request that WOULD be sent without contacting Adobe at all. " +
        "Nothing is created and the 'confirm' gate is skipped. Note that Adobe does not offer a " +
        "server-side dry run for this endpoint, so this validates shape only, not acceptance.",
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
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Data Hygiene",
        operation: "write",
        requiresEntitlement: "Data Distiller / Data Hygiene",
        destructive: true,
      },
    TOOL_DESCRIPTION,
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


        // Corrected 2026-08-14 against Adobe's dataset-expiration API docs.
        //
        // This previously issued:
        //   PUT /data/core/hygiene/ttl/{datasetId}?dryRun=true
        //
        // Three things were wrong, and together they were dangerous:
        //
        //   1. Adobe documents POST, not PUT.
        //   2. Adobe puts `datasetId` in the BODY, not the path.
        //   3. `dryRun` is not documented anywhere in Adobe's dataset
        //      expiration API.
        //
        // (3) is the one that mattered. The tool advertised dryRun as a safe
        // preview, but it did not stop locally — it sent a real mutating
        // request with an extra query parameter. Servers routinely ignore
        // query parameters they do not recognise, so a "dry run" against a
        // working endpoint would have created a REAL scheduled deletion of a
        // real dataset. In a shared sandbox that is somebody else's data.
        //
        // dryRun is therefore no longer sent to Adobe at all. It is now a
        // purely LOCAL preview that returns the exact request we would have
        // made and sends nothing. That is the only honest way to offer a dry
        // run for an API with no dry-run support.
        const requestSpec = {
          method: "POST" as const,
          path: "/data/core/hygiene/ttl",
          body: { ...body, datasetId },
        };

        if (dryRun) {
          logger.info(
            { tool: TOOL_NAME, datasetId, expiry },
            "DRY RUN — no request sent to Adobe",
          );
          return toolResult({
            dryRun: true,
            sent: false,
            wouldSend: requestSpec,
            _warning:
              "Adobe does not document a dry-run mode for dataset expiration. " +
              "This preview is generated LOCALLY and no request was sent. It " +
              "confirms the request shape only — it does NOT confirm that " +
              "Adobe would accept it.",
            _nextStep:
              `To actually schedule the expiration, re-run with dryRun=false and ` +
              `confirm='${CONFIRMATION_PHRASE}'. That WILL schedule permanent ` +
              `deletion of dataset ${datasetId}.`,
          });
        }

        const response =
          await ctx.client.request<DatasetExpiration | undefined>(requestSpec);

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
