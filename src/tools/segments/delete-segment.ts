import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { Segment } from "../../types/aep.js";
import { toolResult, toolError, mapApiError, AepApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_delete_segment";

/** Bound to the segment id so a confirmation cannot be reused on another segment. */
const confirmPhrase = (segmentId: string) => `DELETE SEGMENT ${segmentId}`;

const FORBIDDEN_IDS = new Set(["all", "*", "any", "null", "undefined"]);
const ID_PATTERN = /^[A-Za-z0-9_:.-]+$/;

const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Permanently delete a segment definition from Adobe Experience Platform. " +
  "The definition and its evaluation history are removed; profiles are not deleted, but any " +
  "activation depending on this segment stops resolving.\n" +
  "\n" +
  "Until v0.9.1 segments could be created but never removed, so every segment an agent made was " +
  "permanent. That asymmetry is what this closes.\n" +
  "\n" +
  "REQUIRED CONFIRMATION: pass 'confirm' set to the EXACT string 'DELETE SEGMENT <segmentId>', " +
  "naming the same segment. Any other value rejects the call BEFORE any network request.\n" +
  "\n" +
  "EXCEPTION: when 'dryRun' is true (the default) nothing is sent and no confirmation is needed. " +
  "The dry run is purely LOCAL — it contacts Adobe only to confirm the segment exists.\n" +
  "\n" +
  "Deletion is verified by a follow-up GET. Adobe answers DELETE with 200 and an empty body, which " +
  "is not evidence the definition is gone, so the tool re-reads it and reports what it actually finds.";

const inputSchema = {
  segmentId: z
    .string()
    .min(1)
    .describe(
      "The EXACT id of the single segment definition to delete. Wildcards, 'ALL', and " +
        "comma-separated lists are REFUSED — this tool acts on one segment.",
    ),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "DEFAULTS TO TRUE. Resolves the segment and reports what would be deleted without " +
        "deleting it. Pass false, with 'confirm', to actually delete.",
    ),
  confirm: z
    .string()
    .optional()
    .describe("Required when dryRun is false. Must equal exactly 'DELETE SEGMENT <segmentId>'."),
};

const SEGMENT_BASE = "/data/core/ups/segment/definitions";

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
      product: "Adobe Experience Platform",
      category: "Segments",
      operation: "delete",
      destructive: true,
    },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { segmentId, dryRun, confirm } = args;
      const id = segmentId.trim();

      if (id === "" || FORBIDDEN_IDS.has(id.toLowerCase()) || id.includes(",") || !ID_PATTERN.test(id)) {
        return toolError({
          code: "INVALID_SEGMENT_ID",
          message:
            `Refusing segmentId '${segmentId}'. Pass the exact id of ONE segment — wildcards, ` +
            `'ALL', comma-separated lists and blank values are never accepted.`,
        });
      }

      const encoded = encodeURIComponent(id);

      try {
        // Preflight: a delete against a non-existent id should say so plainly
        // rather than surfacing a bare 404 from the delete call itself.
        let existing: Segment | undefined;
        try {
          existing = await ctx.client.request<Segment>({
            method: "GET",
            path: `${SEGMENT_BASE}/${encoded}`,
          });
        } catch (err) {
          if (err instanceof AepApiError && err.status === 404) {
            return toolError({
              code: "SEGMENT_NOT_FOUND",
              message: `No segment definition with id '${id}' exists in this sandbox.`,
            });
          }
          throw err;
        }

        const summary = {
          segmentId: id,
          name: existing?.name ?? null,
          description: existing?.description ?? null,
        };

        if (dryRun) {
          return toolResult({
            dryRun: true,
            sent: false,
            wouldDelete: summary,
            _warning:
              "This would PERMANENTLY delete the segment definition. Activations that depend on " +
              "it stop resolving. Profiles themselves are not deleted.",
            _nextStep:
              `To delete, re-run with dryRun=false and confirm='${confirmPhrase(id)}'.`,
          });
        }

        if (confirm !== confirmPhrase(id)) {
          logger.warn(
            { tool: TOOL_NAME, segmentId: id, confirmProvided: Boolean(confirm) },
            "Segment deletion rejected: confirmation missing or does not match this segment id",
          );
          return toolError({
            code: "CONFIRMATION_REQUIRED",
            message:
              `Deleting a segment is permanent. Re-invoke with confirm='${confirmPhrase(id)}' ` +
              `(exact match), or pass dryRun=true to preview.`,
          });
        }

        logger.warn({ tool: TOOL_NAME, segmentId: id }, "DESTRUCTIVE: deleting segment definition");
        await ctx.client.request<unknown>({ method: "DELETE", path: `${SEGMENT_BASE}/${encoded}` });

        // Postcondition. Adobe answers DELETE with 200 and an empty body; that
        // is the write's own report of itself, not evidence. A GET is what
        // actually settles whether the definition is gone.
        let gone = false;
        try {
          await ctx.client.request<Segment>({ method: "GET", path: `${SEGMENT_BASE}/${encoded}` });
        } catch (err) {
          if (err instanceof AepApiError && err.status === 404) gone = true;
          else throw err;
        }

        if (!gone) {
          return toolError({
            code: "DELETE_NOT_CONFIRMED",
            message:
              `The DELETE call succeeded but segment '${id}' is still readable. Treat it as NOT ` +
              `deleted and re-check with aep_get_segment before assuming otherwise.`,
          });
        }

        logger.info({ tool: TOOL_NAME, segmentId: id }, "Segment deleted and verified gone");
        return toolResult({
          success: true,
          deleted: summary,
          verifiedGone: true,
          message: `Segment '${id}' deleted. A follow-up GET returned 404, confirming removal.`,
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, segmentId: id, err }, "Failed to delete segment");
        return toolError(mapApiError(err));
      }
    },
  );
}
