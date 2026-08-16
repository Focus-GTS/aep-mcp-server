import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

/**
 * Get / update / cancel for dataset expirations.
 *
 * None of these existed. The repo shipped create and list only, so an
 * expiration could be scheduled and never inspected, amended, or called off —
 * the one operation with a delayed destructive effect had no way back.
 *
 * Verified against Adobe's Dataset Expiration API documentation 2026-08-16:
 *   GET    /data/core/hygiene/ttl/{ttlId|datasetId}
 *   GET    /data/core/hygiene/ttl/{id}?include=history
 *   PUT    /data/core/hygiene/ttl/{ttlId}          <- ttlId ONLY
 *   DELETE /data/core/hygiene/ttl/{ttlId|datasetId}
 *
 * Statuses: pending, executing, cancelled, completed.
 * Update and cancel are only valid while status is `pending`.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_IDS = new Set(["all", "*", "any", "null", "undefined"]);

type IdCheck =
  | { ok: true; id: string }
  | { ok: false; error: ReturnType<typeof toolError> };

function validateId(raw: string, label: string): IdCheck {
  const id = raw.trim();
  if (id === "") return { ok: false, error: toolError({ code: "INVALID_ID", message: `${label} is blank.` }) };
  if (FORBIDDEN_IDS.has(id.toLowerCase())) {
    return {
      ok: false,
      error: toolError({
        code: "FORBIDDEN_ID",
        message:
          `${label} '${id}' is forbidden. These tools act on exactly one expiration by its ` +
          `exact id; wildcards, 'ALL', and names are never accepted.`,
      }),
    };
  }
  if (!ID_PATTERN.test(id)) {
    return {
      ok: false,
      error: toolError({
        code: "INVALID_ID",
        message:
          `${label} '${id}' contains characters outside [A-Za-z0-9_-]. Pass an exact id, not a ` +
          `name, path, or pattern.`,
      }),
    };
  }
  return { ok: true, id };
}

interface Expiration {
  ttlId?: string;
  datasetId?: string;
  status?: string;
  expiry?: string;
  displayName?: string;
  description?: string;
  history?: unknown[];
}

/** Unwraps Adobe's single-expiration response, which may or may not be keyed. */
function unwrap(raw: unknown, id: string): Expiration | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.ttlId || obj.datasetId || obj.status) return obj as Expiration;
  const keyed = obj[id];
  if (keyed && typeof keyed === "object") return keyed as Expiration;
  const first = Object.values(obj)[0];
  return first && typeof first === "object" ? (first as Expiration) : null;
}

const PENDING = "pending";

export function register(server: McpServer, ctx: ToolContext): void {
  // ------------------------------------------------------------------ GET
  defineTool(
    server,
    "aep_get_dataset_expiration",
    { product: "Adobe Experience Platform", category: "Data Hygiene", operation: "read" },
    "Look up a single Adobe Experience Platform dataset expiration.\n" +
      "\n" +
      "GET /data/core/hygiene/ttl/{id} — the id may be either a ttlId or a datasetId.\n" +
      "\n" +
      "Set includeHistory=true to append ?include=history, which returns a history array of " +
      "configuration changes. Read-only.",
    {
      id: z
        .string()
        .min(1)
        .describe("Either the ttlId (e.g. 'SD-c1f902aa-...') or the datasetId of the expiration."),
      includeHistory: z
        .boolean()
        .optional()
        .default(false)
        .describe("When true, request ?include=history and return the change history."),
    },
    async (args) => {
      const v = validateId(args.id, "id");
      if (!v.ok) return v.error;
      try {
        const raw = await ctx.client.request<unknown>({
          method: "GET",
          path: `/data/core/hygiene/ttl/${encodeURIComponent(v.id)}`,
          ...(args.includeHistory ? { query: { include: "history" } } : {}),
        });
        const exp = unwrap(raw, v.id);
        if (!exp) {
          return toolError({ code: "EXPIRATION_NOT_FOUND", message: `No expiration found for '${v.id}'.` });
        }
        return toolResult({
          ttlId: exp.ttlId ?? null,
          datasetId: exp.datasetId ?? null,
          status: exp.status ?? null,
          expiry: exp.expiry ?? null,
          displayName: exp.displayName ?? null,
          ...(args.includeHistory ? { history: exp.history ?? [] } : {}),
          _note:
            exp.status === PENDING
              ? "Status is pending — this expiration can still be updated or cancelled."
              : `Status is '${exp.status}'. Only a pending expiration can be updated or cancelled.`,
        });
      } catch (err) {
        logger.error({ tool: "aep_get_dataset_expiration", id: v.id, err }, "Lookup failed");
        return toolError(mapApiError(err));
      }
    },
  );

  // --------------------------------------------------------------- UPDATE
  defineTool(
    server,
    "aep_update_dataset_expiration",
    { product: "Adobe Experience Platform", category: "Data Hygiene", operation: "write", destructive: true },
    "Amend a PENDING Adobe Experience Platform dataset expiration.\n" +
      "\n" +
      "PUT /data/core/hygiene/ttl/{ttlId} — this endpoint takes the ttlId ONLY, not a datasetId.\n" +
      "\n" +
      "At least one of displayName, description, or expiry must be supplied. Adobe permits this " +
      "only while the expiration's status is 'pending'; the tool reads the current state first " +
      "and refuses otherwise, naming the actual status.\n" +
      "\n" +
      "dryRun DEFAULTS TO TRUE. A real update requires dryRun=false and " +
      "confirm='UPDATE DATASET EXPIRATION <ttlId>'.",
    {
      ttlId: z.string().min(1).describe("The ttlId of the expiration. A datasetId is NOT accepted here."),
      expiry: z.string().datetime().optional().describe("New ISO 8601 expiry timestamp."),
      displayName: z.string().min(1).optional().describe("New display name."),
      description: z.string().optional().describe("New description."),
      dryRun: z.boolean().optional().default(true).describe("DEFAULTS TO TRUE. Returns the request without sending it."),
      confirm: z.string().optional().describe("Required when dryRun is false: 'UPDATE DATASET EXPIRATION <ttlId>'."),
    },
    async (args) => {
      const v = validateId(args.ttlId, "ttlId");
      if (!v.ok) return v.error;
      const { id } = v;

      const patch: Record<string, unknown> = {};
      if (args.expiry !== undefined) patch.expiry = args.expiry;
      if (args.displayName !== undefined) patch.displayName = args.displayName;
      if (args.description !== undefined) patch.description = args.description;
      if (Object.keys(patch).length === 0) {
        return toolError({
          code: "NOTHING_TO_UPDATE",
          message: "Supply at least one of expiry, displayName, or description.",
        });
      }

      const spec = {
        method: "PUT" as const,
        path: `/data/core/hygiene/ttl/${encodeURIComponent(id)}`,
        body: patch,
      };
      if (args.dryRun) return toolResult({ dryRun: true, sent: false, wouldSend: spec });

      const expected = `UPDATE DATASET EXPIRATION ${id}`;
      if (args.confirm !== expected) {
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message: `Re-invoke with confirm='${expected}' (exact match).`,
        });
      }

      try {
        // Preflight: Adobe only allows updates while pending, and a clear
        // refusal naming the real status beats a generic API rejection.
        const before = unwrap(
          await ctx.client.request<unknown>({
            method: "GET",
            path: `/data/core/hygiene/ttl/${encodeURIComponent(id)}`,
          }),
          id,
        );
        if (!before) return toolError({ code: "EXPIRATION_NOT_FOUND", message: `No expiration '${id}'.` });
        if (String(before.status).toLowerCase() !== PENDING) {
          return toolError({
            code: "NOT_PENDING",
            message: `Expiration '${id}' has status '${before.status}'. Only a pending expiration can be updated.`,
            details: { status: before.status },
          });
        }

        logger.warn({ tool: "aep_update_dataset_expiration", ttlId: id }, "Updating pending expiration");
        await ctx.client.request<unknown>(spec);

        // Postcondition read — the write response is not the authority.
        const after = unwrap(
          await ctx.client.request<unknown>({
            method: "GET",
            path: `/data/core/hygiene/ttl/${encodeURIComponent(id)}`,
          }),
          id,
        );
        const applied =
          args.expiry === undefined || String(after?.expiry ?? "").startsWith(args.expiry.slice(0, 10));
        return toolResult({
          updated: true,
          ttlId: id,
          statusAfter: after?.status ?? null,
          expiryAfter: after?.expiry ?? null,
          displayNameAfter: after?.displayName ?? null,
          changeConfirmedByGet: applied,
          ...(applied ? {} : { _warning: "The follow-up GET does not reflect the requested expiry. Verify manually." }),
        });
      } catch (err) {
        logger.error({ tool: "aep_update_dataset_expiration", ttlId: id, err }, "Update failed");
        return toolError(mapApiError(err));
      }
    },
  );

  // --------------------------------------------------------------- CANCEL
  defineTool(
    server,
    "aep_cancel_dataset_expiration",
    { product: "Adobe Experience Platform", category: "Data Hygiene", operation: "delete", destructive: true },
    "Cancel a PENDING Adobe Experience Platform dataset expiration, so the scheduled deletion " +
      "does not happen.\n" +
      "\n" +
      "DELETE /data/core/hygiene/ttl/{id} — the id may be a ttlId or a datasetId.\n" +
      "\n" +
      "This is the SAFE direction: it prevents a deletion rather than causing one. Adobe permits " +
      "it only while status is 'pending'; the tool reads the state first and refuses otherwise. " +
      "Success is confirmed by a follow-up GET reporting status 'cancelled', not by the response " +
      "body.\n" +
      "\n" +
      "dryRun DEFAULTS TO TRUE. A real cancel requires dryRun=false and " +
      "confirm='CANCEL DATASET EXPIRATION <id>'.",
    {
      id: z.string().min(1).describe("The ttlId or datasetId of the expiration to cancel."),
      dryRun: z.boolean().optional().default(true).describe("DEFAULTS TO TRUE. Returns the request without sending it."),
      confirm: z.string().optional().describe("Required when dryRun is false: 'CANCEL DATASET EXPIRATION <id>'."),
    },
    async (args) => {
      const v = validateId(args.id, "id");
      if (!v.ok) return v.error;
      const { id } = v;

      const spec = {
        method: "DELETE" as const,
        path: `/data/core/hygiene/ttl/${encodeURIComponent(id)}`,
      };
      if (args.dryRun) return toolResult({ dryRun: true, sent: false, wouldSend: spec });

      const expected = `CANCEL DATASET EXPIRATION ${id}`;
      if (args.confirm !== expected) {
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message: `Re-invoke with confirm='${expected}' (exact match).`,
        });
      }

      try {
        const before = unwrap(
          await ctx.client.request<unknown>({
            method: "GET",
            path: `/data/core/hygiene/ttl/${encodeURIComponent(id)}`,
          }),
          id,
        );
        if (!before) return toolError({ code: "EXPIRATION_NOT_FOUND", message: `No expiration '${id}'.` });
        if (String(before.status).toLowerCase() !== PENDING) {
          return toolError({
            code: "NOT_PENDING",
            message:
              `Expiration '${id}' has status '${before.status}'. Only a pending expiration can be ` +
              `cancelled — an executing or completed one cannot be called back.`,
            details: { status: before.status },
          });
        }

        logger.warn({ tool: "aep_cancel_dataset_expiration", id }, "Cancelling pending expiration");
        await ctx.client.request<unknown>(spec);

        // Authoritative postcondition.
        const after = unwrap(
          await ctx.client.request<unknown>({
            method: "GET",
            path: `/data/core/hygiene/ttl/${encodeURIComponent(id)}`,
          }),
          id,
        );
        const statusAfter = String(after?.status ?? "unknown").toLowerCase();
        const cancelled = statusAfter === "cancelled";
        if (!cancelled) {
          return toolError({
            code: "CANCEL_NOT_CONFIRMED",
            message:
              `The DELETE was accepted but a follow-up GET reports status '${statusAfter}', not ` +
              `'cancelled'. Treat the expiration as STILL SCHEDULED and verify before relying on it.`,
            details: { statusAfter },
          });
        }
        return toolResult({ cancelled: true, id, statusAfter, cancelConfirmedByGet: true });
      } catch (err) {
        logger.error({ tool: "aep_cancel_dataset_expiration", id, err }, "Cancel failed");
        return toolError(mapApiError(err));
      }
    },
  );
}
