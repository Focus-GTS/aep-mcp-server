import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

/**
 * ABORT and REVERT for batch ingestion.
 *
 * Both were missing entirely — the server shipped create, upload, complete,
 * get, and list, with no way to cancel or remove a batch. So the only exit
 * from a created batch was to complete it, which is precisely the irreversible
 * step. (The validation matrix listed an `aep_cancel_batch`; no such tool
 * existed. That was an error in our own documentation.)
 *
 * Verified against Adobe's Batch Ingestion API documentation 2026-08-15:
 *   POST /data/foundation/import/batches/{BATCH_ID}?action=ABORT
 *   POST /data/foundation/import/batches/{BATCH_ID}?action=REVERT
 *
 * Action casing is UPPERCASE and matters.
 */

const BATCH_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_IDS = new Set(["all", "*", "any", "null", "undefined"]);

/** Shared id validation. Neither action may ever target a wildcard. */
function validateBatchId(raw: string): { id: string } | { error: ReturnType<typeof toolError> } {
  const id = raw.trim();
  if (id === "") {
    return { error: toolError({ code: "INVALID_BATCH_ID", message: "batchId is blank." }) };
  }
  if (FORBIDDEN_IDS.has(id.toLowerCase())) {
    return {
      error: toolError({
        code: "FORBIDDEN_BATCH_ID",
        message:
          `batchId '${id}' is forbidden. These actions target exactly one batch by its ` +
          `exact id; wildcards are never accepted.`,
      }),
    };
  }
  if (!BATCH_ID_PATTERN.test(id)) {
    return {
      error: toolError({
        code: "INVALID_BATCH_ID",
        message: `batchId '${id}' contains characters outside [A-Za-z0-9_-]. Pass an exact id.`,
      }),
    };
  }
  return { id };
}

const idSchema = {
  batchId: z
    .string()
    .min(1)
    .describe("The exact id of the batch, as returned by aep_create_batch or aep_list_batches."),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "DEFAULTS TO TRUE. Returns the request that would be sent without sending it. " +
        "Pass false to actually perform the action.",
    ),
};

// ---------------------------------------------------------------- ABORT

const ABORT_NAME = "aep_abort_batch";
const ABORT_DESCRIPTION =
  "Cancels an in-flight Adobe Experience Platform ingestion batch.\n" +
  "\n" +
  "POST /data/foundation/import/batches/{batchId}?action=ABORT\n" +
  "\n" +
  "Only works while the batch is still processing. Once a batch reaches a terminal state " +
  "(success, failed, or already aborted) Adobe will not cancel it.\n" +
  "\n" +
  "ABORT and REVERT are ALTERNATIVES, not a sequence. Adobe's guidance: a batch in progress " +
  "should be ABORTed; a batch that has been successfully mastered should be REVERTed. " +
  "Verified live 2026-08-15: calling REVERT on an already-aborted batch returns " +
  "428 ERR-BI-104. 'aborted' is itself the terminal state for a cancelled batch — do not " +
  "expect to follow it with a revert.\n" +
  "\n" +
  "dryRun defaults to TRUE.";

// --------------------------------------------------------------- REVERT

const REVERT_NAME = "aep_revert_batch";
const REVERT_DESCRIPTION =
  "DESTRUCTIVE: Deletes an Adobe Experience Platform ingestion batch and reverts any data it " +
  "ingested.\n" +
  "\n" +
  "POST /data/foundation/import/batches/{batchId}?action=REVERT\n" +
  "\n" +
  "Adobe marks the batch 'inactive', which makes it eligible for garbage collection; it is " +
  "later collected asynchronously and marked 'deleted'. So 'inactive' is the expected " +
  "immediate outcome — do NOT wait for 'deleted' before proceeding.\n" +
  "\n" +
  "USE THIS FOR A COMPLETED BATCH, NOT AN ABORTED ONE. ABORT and REVERT are alternatives. " +
  "Reverting an already-aborted batch returns 428 ERR-BI-104 (verified live 2026-08-15).\n" +
  "\n" +
  "REQUIRED CONFIRMATION when dryRun is false: 'REVERT BATCH <batchId>', naming the same id.\n" +
  "\n" +
  "dryRun defaults to TRUE.";

function buildSpec(action: "ABORT" | "REVERT", id: string) {
  return {
    method: "POST" as const,
    path: `/data/foundation/import/batches/${encodeURIComponent(id)}`,
    query: { action },
  };
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    ABORT_NAME,
    { product: "Adobe Experience Platform", category: "Ingestion", operation: "write" },
    ABORT_DESCRIPTION,
    idSchema,
    async (args) => {
      const check = validateBatchId(args.batchId);
      if ("error" in check) return check.error;
      const spec = buildSpec("ABORT", check.id);

      if (args.dryRun) {
        return toolResult({ dryRun: true, sent: false, wouldSend: spec });
      }
      try {
        logger.warn({ tool: ABORT_NAME, batchId: check.id }, "Aborting batch");
        const response = await ctx.client.request<unknown>(spec);
        return toolResult({
          aborted: true,
          batchId: check.id,
          response: response ?? null,
          _nextStep:
            `Confirm with aep_get_batch_status('${check.id}'). To remove the batch entirely, ` +
            `use aep_revert_batch.`,
        });
      } catch (err) {
        logger.error({ tool: ABORT_NAME, batchId: check.id, err }, "Batch abort failed");
        return toolError(mapApiError(err));
      }
    },
  );

  defineTool(
    server,
    REVERT_NAME,
    {
      product: "Adobe Experience Platform",
      category: "Ingestion",
      operation: "delete",
      destructive: true,
    },
    REVERT_DESCRIPTION,
    {
      ...idSchema,
      confirm: z
        .string()
        .optional()
        .describe("Required when dryRun is false. Must equal exactly 'REVERT BATCH <batchId>'."),
    },
    async (args) => {
      const check = validateBatchId(args.batchId);
      if ("error" in check) return check.error;
      const { id } = check;
      const spec = buildSpec("REVERT", id);

      if (args.dryRun) {
        return toolResult({ dryRun: true, sent: false, wouldSend: spec });
      }

      const expected = `REVERT BATCH ${id}`;
      if (args.confirm !== expected) {
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message:
            `Reverting a batch deletes it and reverts any data it ingested. Re-invoke with ` +
            `confirm='${expected}' (exact match).`,
        });
      }

      try {
        // PREFLIGHT. REVERT applies to a batch that was successfully mastered.
        // Calling it on an aborted batch returns 428 ERR-BI-104 (verified live
        // 2026-08-15), and calling it on a still-loading batch is meaningless.
        // Reading the state first turns a confusing API error into a clear
        // refusal that names the actual status.
        const rec = await ctx.client.get<Record<string, { status?: string } | undefined>>(
          `/data/foundation/catalog/batches/${encodeURIComponent(id)}`,
        );
        const current = String(
          (Object.values(rec ?? {})[0] ?? {}).status ?? "unknown",
        ).toLowerCase();
        if (!["active", "success"].includes(current)) {
          return toolError({
            code: "REVERT_PRECONDITION_FAILED",
            message:
              `Batch '${id}' has status '${current}'. REVERT applies only to a batch that ` +
              `reached Active or Success. An aborted batch is already terminal — Adobe returns ` +
              `428 ERR-BI-104 for that case — and a loading batch should be ABORTed instead.`,
            details: { batchStatus: current },
          });
        }

        logger.warn({ tool: REVERT_NAME, batchId: id, status: current }, "DESTRUCTIVE: reverting batch");
        const response = await ctx.client.request<unknown>(spec);
        return toolResult({
          reverted: true,
          batchId: id,
          response: response ?? null,
          _note:
            "Adobe marks the batch 'inactive' immediately and garbage-collects it " +
            "asynchronously. 'inactive' is the expected state; 'deleted' may take longer.",
          _nextStep: `Poll aep_get_batch_status('${id}') until it reports inactive or deleted.`,
        });
      } catch (err) {
        logger.error({ tool: REVERT_NAME, batchId: id, err }, "Batch revert failed");
        return toolError(mapApiError(err));
      }
    },
  );
}
