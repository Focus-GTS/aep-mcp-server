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

interface DeleteAttempt {
  kind: "documented" | "unexpected-2xx" | "target-absent" | "auth-failure" | "ambiguous";
  status: number | null;
  reason?: string;
}

interface Verification {
  /** True only when a GET definitively reported the dataset absent. */
  gone: boolean;
  /** Status of the LAST verification GET. 404 means absent. */
  status: number | null;
  attempts: number;
}

/** Injectable so tests do not actually wait. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The authoritative check: does the dataset still exist?
 *
 * Catalog is eventually consistent enough that a delete may not be visible on
 * the very next read, so up to three read-only GETs are made with a short
 * backoff. Only a 404 proves absence; a 401/403/5xx means we genuinely do not
 * know, which is reported rather than guessed.
 */
export async function verifyGone(
  ctx: ToolContext,
  id: string,
  sleep: Sleep = realSleep,
): Promise<Verification> {
  const delays = [0, 500, 1500];
  let status: number | null = null;

  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    try {
      const r = await ctx.client.get<DatasetMap>(
        `/data/foundation/catalog/dataSets/${encodeURIComponent(id)}`,
      );
      const present = Boolean(Object.entries(r ?? {}).find(([k]) => k === id)?.[1]);
      status = 200;
      if (!present) return { gone: true, status: 404, attempts: i + 1 };
      // Present — keep waiting in case the delete is still propagating.
    } catch (e) {
      status = (e as { status?: number })?.status ?? null;
      if (status === 404) return { gone: true, status: 404, attempts: i + 1 };
      // 401/403/5xx/network: unknown. Stop; retrying will not clarify it.
      return { gone: false, status, attempts: i + 1 };
    }
  }
  return { gone: false, status, attempts: delays.length };
}

export function register(server: McpServer, ctx: ToolContext, sleep: Sleep = realSleep): void {
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

        // ---- The deletion state machine ----------------------------------
        //
        // The authority on whether a dataset is gone is a GET returning 404 —
        // NOT the DELETE response body. That inversion matters: an unverified
        // assumption about the success-response shape would otherwise make the
        // tool report failure for a deletion that actually happened, and an
        // operator would then chase an orphan that does not exist.
        //
        // The response shape is still classified and reported, because a
        // mismatch is worth knowing about. It just does not decide the outcome.
        const attempt = async (): Promise<DeleteAttempt> => {
          try {
            const body = await ctx.client.request<unknown>(requestSpec);
            const verdict = verifyDeleteResponse(body, id);
            return verdict.ok
              ? { kind: "documented", status: 200 }
              : { kind: "unexpected-2xx", status: 200, reason: verdict.reason };
          } catch (e) {
            // The write guard rejects locally, before any HTTP call, so these
            // carry no status. Surfacing them as "ambiguous" would bury a
            // clear, actionable configuration error under a retry path — and
            // there is nothing ambiguous about a refusal we issued ourselves.
            const name = (e as Error)?.name;
            if (
              name === "MutationsDisabledError" ||
              name === "ProductionSandboxNameError" ||
              name === "WriteBlockedError"
            ) {
              throw e;
            }
            const status = (e as { status?: number })?.status ?? null;
            if (status === 404) return { kind: "target-absent", status };
            if (status === 401 || status === 403) return { kind: "auth-failure", status };
            if (status === 429 || (status !== null && status >= 500)) {
              return { kind: "ambiguous", status };
            }
            if (status === null) return { kind: "ambiguous", status: null };
            throw e;
          }
        };

        let outcome = await attempt();
        let retryPerformed = false;

        // ---- Authoritative verification, with propagation tolerance -------
        let verification = await verifyGone(ctx, id, sleep);

        // Retry ONLY for an ambiguous outcome, and only while the dataset is
        // demonstrably still present. An unexpected response body is never a
        // reason to retry once the GET already says 404.
        if (
          outcome.kind === "ambiguous" &&
          verification.status === 200 &&
          !verification.gone
        ) {
          logger.warn(
            { tool: TOOL_NAME, datasetId: id, status: outcome.status },
            "Ambiguous delete outcome and dataset still present — retrying once",
          );
          retryPerformed = true;
          outcome = await attempt();
          verification = await verifyGone(ctx, id, sleep);
        }

        const payload = {
          datasetId: id,
          name: info.name,
          deleteResponseMatchedDocumentation: outcome.kind === "documented",
          responseContractMismatch:
            outcome.kind === "unexpected-2xx" ? (outcome.reason ?? "unexpected 2xx body") : null,
          deleteOutcome: outcome.kind,
          deleteStatus: outcome.status,
          postDeleteGetStatus: verification.status,
          cleanupConfirmed: verification.gone,
          retryPerformed,
          verificationAttempts: verification.attempts,
        };

        if (outcome.kind === "auth-failure") {
          return toolError({
            code: "DELETE_AUTH_FAILURE",
            message:
              `Deletion refused with HTTP ${outcome.status}. Not retried — an authorization ` +
              `failure will not resolve itself. The dataset was NOT deleted.`,
            ...payload,
          });
        }

        if (verification.gone) {
          logger.info({ tool: TOOL_NAME, datasetId: id }, "Deletion confirmed by GET 404");
          return toolResult({
            deleted: true,
            ...payload,
            _note:
              outcome.kind === "documented"
                ? undefined
                : `Deletion CONFIRMED by GET returning 404, though the DELETE response was ` +
                  `'${outcome.kind}'. The GET is authoritative.`,
          });
        }

        if (verification.status === null || verification.status >= 401) {
          return toolError({
            code: "CLEANUP_UNKNOWN",
            message:
              `Could not verify the outcome: the confirming GET returned ` +
              `${verification.status ?? "a network error"}. The dataset may or may not have ` +
              `been deleted. Do NOT retry blindly — establish the true state first.`,
            ...payload,
          });
        }

        return toolError({
          code: "DELETE_NOT_CONFIRMED",
          message:
            `The dataset still exists after the delete attempt${retryPerformed ? " and one retry" : ""}. ` +
            `GET returned ${verification.status}. Treat '${id}' as an ORPHAN requiring cleanup.`,
          ...payload,
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, datasetId: id, err }, "Dataset deletion failed");
        return toolError(mapApiError(err));
      }
    },
  );
}
