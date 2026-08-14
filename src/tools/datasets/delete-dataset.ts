import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_delete_dataset";

/** Reserved id that must never reach the network. */
const FORBIDDEN_IDS = new Set(["all", "*", "any", "null", "undefined"]);

/** Adobe dataset ids are hex-ish; anything else is a path-traversal or wildcard attempt. */
const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const TOOL_DESCRIPTION =
  "DESTRUCTIVE: Permanently deletes an Adobe Experience Platform dataset and all data it " +
  "contains. This CANNOT be undone. Adobe provides no restore.\n" +
  "\n" +
  "DRY RUN BY DEFAULT: dryRun defaults to TRUE. A real deletion requires BOTH dryRun=false and " +
  "the id-bound confirmation below.\n" +
  "\n" +
  "REQUIRED CONFIRMATION: callers MUST pass 'confirm' set to the EXACT string " +
  "'DELETE DATASET <datasetId>', naming the same id being deleted. A generic phrase is not " +
  "accepted — the confirmation is bound to the specific dataset so a copy-pasted confirmation " +
  "cannot authorise deleting a different one. If allowProfileEnabled=true, the required phrase " +
  "instead becomes 'DELETE PROFILE-ENABLED DATASET <datasetId>'.\n" +
  "\n" +
  "PREFLIGHT: the dataset is fetched and inspected before any DELETE is issued. Datasets that " +
  "are Profile-enabled, system-managed, or application-managed are REFUSED by default, because " +
  "those are usually shared infrastructure rather than something a caller created.\n" +
  "\n" +
  "Set dryRun=true to run the preflight and return the request that WOULD be sent, without " +
  "issuing any DELETE.\n" +
  "\n" +
  "NOT YET LIVE-VALIDATED: request shape follows Adobe's Catalog API. No dataset has been " +
  "deleted with this tool against a live tenant.";

const inputSchema = {
  datasetId: z
    .string()
    .min(1)
    .describe(
      "The exact id of the dataset to delete, as returned by aep_create_dataset or " +
        "aep_list_datasets. Must be an exact id — this tool never resolves a target by name.",
    ),
  confirm: z
    .string()
    .optional()
    .describe(
      "Required when dryRun is false. Must equal exactly 'DELETE DATASET <datasetId>' for the " +
        "same id passed above.",
    ),
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "DEFAULTS TO TRUE. A real deletion must be asked for explicitly by passing dryRun=false " +
        "AND the id-bound confirmation. When true, runs the preflight and returns the DELETE " +
        "that would be sent, without sending it.",
    ),
  allowProfileEnabled: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Escape hatch to permit deleting a Profile-enabled dataset. Off by default: deleting one " +
        "removes data from Real-Time Customer Profile and can break downstream audiences. " +
        "Setting this ALSO changes the required confirmation to " +
        "'DELETE PROFILE-ENABLED DATASET <datasetId>'.",
    ),
};

/** Catalog returns `{ "<id>": { ...dataset } }`. */
type DatasetMap = Record<string, Record<string, unknown> | undefined>;

interface Preflight {
  name: string;
  schemaRef: string | null;
  profileEnabled: boolean;
  managedBy: string | null;
  systemManaged: boolean;
}

/**
 * Reads the dataset and extracts only what the safety decision needs.
 *
 * Adobe expresses these several ways depending on how the dataset was made, so
 * each is checked rather than assuming one shape.
 */
export function inspectDataset(raw: Record<string, unknown>): Preflight {
  const tags = (raw.tags ?? {}) as Record<string, unknown>;
  const unifiedProfile = tags.unifiedProfile as string[] | undefined;
  const unifiedIdentity = tags.unifiedIdentity as string[] | undefined;

  const profileEnabled =
    (unifiedProfile ?? []).includes("enabled:true") ||
    (unifiedIdentity ?? []).includes("enabled:true") ||
    raw.enabledForProfile === true;

  const managedBy =
    (raw["aep/siphon/managed"] as string | undefined) ??
    ((tags["aep/siphon/managed"] as string[] | undefined)?.[0] ?? null) ??
    ((raw.managedBy as string | undefined) ?? null);

  // Adobe marks internal datasets in more than one way; treat any as system.
  const systemManaged =
    raw.isSystemDataset === true ||
    (typeof managedBy === "string" && managedBy.length > 0) ||
    String(raw.name ?? "").startsWith("_") ||
    Array.isArray(tags.adobeInternal);

  return {
    name: String(raw.name ?? "(unnamed)"),
    schemaRef:
      ((raw.schemaRef as Record<string, unknown> | undefined)?.id as string | undefined) ??
      (raw.schema as string | undefined) ??
      null,
    profileEnabled,
    managedBy: typeof managedBy === "string" ? managedBy : null,
    systemManaged,
  };
}

/**
 * Adobe answers a successful Catalog delete with the deleted resource path:
 *   ["@/dataSets/<id>"]
 *
 * A 200 alone is NOT success. An empty array means nothing was deleted, and
 * an array naming a different id means we deleted something we did not target
 * — which must be surfaced loudly rather than reported as a clean result.
 */
export function verifyDeleteResponse(
  response: unknown,
  datasetId: string,
): { ok: true } | { ok: false; reason: string } {
  const expected = `@/dataSets/${datasetId}`;
  if (!Array.isArray(response)) {
    return { ok: false, reason: `expected an array of deleted resource paths, got ${typeof response}` };
  }
  if (response.length === 0) {
    return { ok: false, reason: "Adobe returned 200 with an EMPTY array — nothing was deleted" };
  }
  if (response.length !== 1) {
    return { ok: false, reason: `expected exactly one deleted path, got ${response.length}` };
  }
  if (response[0] !== expected) {
    return {
      ok: false,
      reason: `response names '${String(response[0])}' but we targeted '${expected}'`,
    };
  }
  return { ok: true };
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
      product: "Adobe Experience Platform",
      category: "Datasets",
      operation: "delete",
      destructive: true,
    },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { datasetId, confirm, dryRun, allowProfileEnabled } = args;
      const id = datasetId.trim();

      // ---- Gate 1: the id itself, before anything else -------------------
      if (id === "") {
        return toolError({ code: "INVALID_DATASET_ID", message: "datasetId is blank." });
      }
      if (FORBIDDEN_IDS.has(id.toLowerCase())) {
        return toolError({
          code: "FORBIDDEN_DATASET_ID",
          message:
            `datasetId '${id}' is forbidden. This tool deletes exactly one dataset by its ` +
            `exact id; wildcards and 'ALL' are never accepted.`,
        });
      }
      if (!DATASET_ID_PATTERN.test(id)) {
        return toolError({
          code: "INVALID_DATASET_ID",
          message:
            `datasetId '${id}' contains characters outside [A-Za-z0-9_-]. Pass an exact id, ` +
            `not a name, path, or pattern.`,
        });
      }

      // ---- Gate 2: confirmation bound to THIS id -------------------------
      //
      // Overriding the Profile-enabled refusal demands a DIFFERENT phrase, so
      // an operator cannot reach that far more damaging outcome by reusing a
      // confirmation they had already typed for an ordinary dataset. The
      // escalation has to be deliberate and separately spelled out.
      const expectedConfirm = allowProfileEnabled
        ? `DELETE PROFILE-ENABLED DATASET ${id}`
        : `DELETE DATASET ${id}`;
      if (!dryRun && confirm !== expectedConfirm) {
        logger.warn(
          { tool: TOOL_NAME, datasetId: id, confirmProvided: Boolean(confirm) },
          "Dataset deletion rejected: confirmation missing or does not match this dataset id",
        );
        return toolError({
          code: "CONFIRMATION_REQUIRED",
          message:
            `Deleting a dataset is permanent. Re-invoke with confirm='${expectedConfirm}' ` +
            `(exact match). The confirmation names the dataset id so it cannot be reused for a ` +
            `different dataset.`,
        });
      }

      try {
        // ---- Gate 3: preflight — read the target before touching it ------
        const existing = await ctx.client.get<DatasetMap>(
          `/data/foundation/catalog/dataSets/${encodeURIComponent(id)}`,
        );
        const entry = Object.entries(existing ?? {}).find(([k]) => k === id)?.[1];
        if (!entry) {
          return toolError({
            code: "DATASET_NOT_FOUND",
            message: `Dataset '${id}' was not found. Nothing was deleted.`,
          });
        }

        const info = inspectDataset(entry);

        if (info.systemManaged) {
          return toolError({
            code: "REFUSED_SYSTEM_DATASET",
            message:
              `Dataset '${id}' ("${info.name}") appears system- or application-managed` +
              (info.managedBy ? ` (managedBy: ${info.managedBy})` : "") +
              `. Refusing to delete it. These are usually shared infrastructure created by ` +
              `Adobe or another application, not by the caller.`,
          });
        }

        if (info.profileEnabled && !allowProfileEnabled) {
          return toolError({
            code: "REFUSED_PROFILE_ENABLED",
            message:
              `Dataset '${id}' ("${info.name}") is enabled for Real-Time Customer Profile. ` +
              `Deleting it removes data from Profile and can break audiences and activations ` +
              `that depend on it. Pass allowProfileEnabled=true only if that is intended.`,
          });
        }

        const requestSpec = {
          method: "DELETE" as const,
          path: `/data/foundation/catalog/dataSets/${encodeURIComponent(id)}`,
        };

        // ---- dryRun: preflight reported, nothing sent --------------------
        if (dryRun) {
          logger.info({ tool: TOOL_NAME, datasetId: id }, "DRY RUN — no DELETE sent");
          return toolResult({
            dryRun: true,
            sent: false,
            preflight: info,
            wouldSend: requestSpec,
            _nextStep:
              `To delete, re-run with dryRun=false and confirm='${expectedConfirm}'. ` +
              `This permanently destroys the dataset and its data.`,
          });
        }

        logger.warn(
          { tool: TOOL_NAME, datasetId: id, name: info.name },
          "DESTRUCTIVE: deleting dataset (confirmation and preflight verified)",
        );

        const response = await ctx.client.request<unknown>(requestSpec);

        // ---- Gate 4: a 200 is not success --------------------------------
        const verdict = verifyDeleteResponse(response, id);
        if (!verdict.ok) {
          logger.error(
            { tool: TOOL_NAME, datasetId: id },
            "Dataset delete returned 200 but the response did not confirm deletion",
          );
          return toolError({
            code: "DELETE_NOT_CONFIRMED",
            message:
              `Adobe returned a success status but the response did not confirm the deletion: ` +
              `${verdict.reason}. Treat the dataset as NOT deleted and verify with ` +
              `aep_get_dataset before retrying.`,
          });
        }

        return toolResult({
          deleted: true,
          datasetId: id,
          name: info.name,
          confirmedBy: `@/dataSets/${id}`,
          _nextStep:
            `Verify with aep_get_dataset('${id}') — it should now return not-found.`,
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, datasetId: id, err }, "Dataset deletion failed");
        return toolError(mapApiError(err));
      }
    },
  );
}
