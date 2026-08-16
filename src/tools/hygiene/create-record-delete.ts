import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { WorkOrder } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

const TOOL_NAME = "aep_create_record_delete";
/**
 * `ALL` is refused outright.
 *
 * The schema used to TELL the model to pass it — "Pass the literal 'ALL' to
 * delete the identities from every dataset in the sandbox". In a shared
 * sandbox that reaches other partners' data, and no confirmation phrase makes
 * that acceptable. The constant is kept only so the refusal can name it.
 */
const ALL_DATASETS = "ALL";
const FORBIDDEN_DATASET_IDS = new Set(["all", "*", "any", "null", "undefined", "prod", "production"]);
const DATASET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Confirmation is bound to the dataset AND a canonical hash of the identity
 * set, so a confirmation cannot be reused after the identity list changes.
 * The hash is over sorted "namespace:id" pairs — order-independent, and it
 * never appears in cleartext.
 */
function identityDigest(identities: ReadonlyArray<{ namespace: string; id: string }>): string {
  const canonical = identities
    .map((i) => `${i.namespace}:${i.id}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

const confirmPhrase = (datasetId: string, digest: string) =>
  `DELETE RECORDS ${datasetId} ${digest}`;

/** Adobe's documented ceiling for one work order. */
const MAX_IDENTITIES_PER_WORK_ORDER = 100_000;

/** Adobe's wire shape: grouped by namespace, ids as a list. */
interface NamespaceIdentities {
  namespace: { code: string };
  ids: string[];
}

/**
 * Converts the flat `{namespace, id}[]` the tool accepts into the
 * `namespacesIdentities` structure the Data Lifecycle API requires.
 *
 * Sending a flat `identities` array instead is silently wrong — it was the
 * shape this tool shipped with, and it is the shape almost everyone writes
 * from memory. Duplicate ids within a namespace are collapsed; namespace
 * ordering follows first appearance so output is deterministic and diffable.
 */
export function toNamespacesIdentities(
  identities: ReadonlyArray<{ namespace: string; id: string }>,
): NamespaceIdentities[] {
  const grouped = new Map<string, Set<string>>();
  for (const { namespace, id } of identities) {
    let ids = grouped.get(namespace);
    if (!ids) {
      ids = new Set<string>();
      grouped.set(namespace, ids);
    }
    ids.add(id);
  }
  return [...grouped].map(([code, ids]) => ({
    namespace: { code },
    ids: [...ids],
  }));
}

const TOOL_DESCRIPTION =
  "DESTRUCTIVE AND IRREVERSIBLE: Submit a record delete work order to the Adobe Experience " +
  "Platform Data Lifecycle API, permanently deleting every record matching the supplied " +
  "identities from ONE dataset.\n" +
  "\n" +
  "A work order CANNOT BE CANCELLED once submitted. Completion may take up to 30 days (15 with " +
  "Privacy and Security Shield). Documented statuses: received, validated, submitted, ingested, " +
  "completed, failed. Note that the request action is 'delete_identity' while Adobe reports " +
  "'identity-delete' in responses.\n" +
  "\n" +
  "datasetId 'ALL' is REFUSED. Comma-separated lists, wildcards, and production sandbox names " +
  "are refused. One exact dataset id only.\n" +
  "\n" +
  "PREFLIGHT: the dataset and its XDM schema are read first. Adobe only deletes records from " +
  "datasets whose schema defines a primary identity or identityMap, so a dataset without one is " +
  "refused rather than submitted to no effect. A dataset with an active expiration is also " +
  "refused.\n" +
  "\n" +
  "dryRun DEFAULTS TO TRUE and contacts Adobe not at all. A real submission needs dryRun=false " +
  "plus confirm='DELETE RECORDS <datasetId> <digest>', where the digest is a hash of the identity " +
  "set returned by the dry run — so a confirmation cannot survive a change to the identities.\n" +
  "\n" +
  "Identity values are never logged, echoed, or returned. Only counts, namespace codes, and the " +
  "digest appear in output.\n" +
  "\n" +
  "This is Adobe's sanctioned replacement for the deprecated delete-entity endpoint wrapped by " +
  "aep_delete_profile.\n" +
  "\n" +
  "NOT LIVE-VALIDATED: contract-verified against Adobe's documentation and mock-tested. " +
  "Deliberately never executed against a live tenant.";

const inputSchema = {
  datasetId: z
    .string()
    .min(1)
    .describe(
      "The EXACT id of the single dataset to delete records from. " +
        `'${ALL_DATASETS}' is REFUSED — it targets every dataset in the organization, which in a ` +
        "shared sandbox reaches other tenants' data. Comma-separated lists, wildcards, and " +
        "production sandbox names are also refused. One exact id only.",
    ),
  /**
   * Deliberately a FLAT array here, and grouped into Adobe's shape on the way
   * out by `toNamespacesIdentities` below.
   *
   * Adobe's wire format is `namespacesIdentities`: an array of
   * `{ namespace: { code }, ids: [...] }` grouped by namespace. That is a
   * needlessly awkward thing to ask a model to assemble correctly, and getting
   * it wrong is silent. A flat list of `{namespace, id}` pairs is far harder to
   * malform, so the tool accepts that and does the grouping itself.
   */
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
    .max(
      MAX_IDENTITIES_PER_WORK_ORDER,
      `Adobe accepts at most ${MAX_IDENTITIES_PER_WORK_ORDER.toLocaleString("en-US")} identities per work order. Split the request.`,
    )
    .describe(
      "One or more identities whose records should be deleted. Every record in scope that " +
        "carries any of these identities is permanently removed. Adobe accepts up to " +
        `${MAX_IDENTITIES_PER_WORK_ORDER.toLocaleString("en-US")} per work order, and recommends ` +
        "batching toward that ceiling rather than issuing many small orders.",
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
  dryRun: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "DEFAULTS TO TRUE. Runs the preflight and returns the request that WOULD be sent — with " +
        "identity values REDACTED — and contacts Adobe not at all. A real submission requires " +
        "dryRun=false plus the confirmation below.",
    ),
  confirm: z
    .string()
    .optional()
    .describe(
      "Required when dryRun is false. Must equal exactly 'DELETE RECORDS <datasetId> <digest>', " +
        "where <digest> is the identity digest returned by the dry run. Binding the confirmation " +
        "to BOTH the dataset and a hash of the identity set means a confirmation cannot be " +
        "reused after the identity list changes.",
    ),
};

interface CreateWorkOrderResponse extends WorkOrder {
  workorderId?: string;
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Experience Platform",
        category: "Data Hygiene",
        operation: "delete",
        requiresEntitlement: "Data Hygiene",
        destructive: true,
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { datasetId, identities, displayName, description, confirm, dryRun } = args;
      const id = datasetId.trim();

      // Identity values are PII. Nothing below ever logs, echoes, or returns
      // them — only counts, namespace codes, and the digest.
      const digest = identityDigest(identities);
      const namespaceCodes = [...new Set(identities.map((i) => i.namespace))].sort();
      const safeSummary = {
        datasetId: id,
        identityCount: identities.length,
        namespaces: namespaceCodes,
        identityDigest: digest,
      };

      // ---- Gate 1: the target, before anything else ----------------------
      if (id === "") {
        return toolError({ code: "INVALID_DATASET_ID", message: "datasetId is blank." });
      }
      if (FORBIDDEN_DATASET_IDS.has(id.toLowerCase())) {
        return toolError({
          code: "FORBIDDEN_DATASET_ID",
          message:
            `datasetId '${id}' is refused. '${ALL_DATASETS}' targets every dataset in the ` +
            `organization — in a shared sandbox that reaches other tenants' data — and ` +
            `production sandbox names are never valid targets. Pass one exact dataset id.`,
        });
      }
      if (id.includes(",")) {
        return toolError({
          code: "MULTIPLE_DATASETS",
          message:
            `datasetId '${id}' looks like a list. This tool targets exactly ONE dataset per ` +
            `work order. Submit separate work orders.`,
        });
      }
      if (!DATASET_ID_PATTERN.test(id)) {
        return toolError({
          code: "INVALID_DATASET_ID",
          message: `datasetId '${id}' contains characters outside [A-Za-z0-9_-]. Pass an exact id.`,
        });
      }

      try {
        // ---- Gate 2: preflight the dataset and its schema ----------------
        const dsMap = await ctx.client.get<Record<string, Record<string, unknown> | undefined>>(
          `/data/foundation/catalog/dataSets/${encodeURIComponent(id)}`,
        );
        const ds = Object.entries(dsMap ?? {}).find(([k]) => k === id)?.[1];
        if (!ds) {
          return toolError({ code: "DATASET_NOT_FOUND", message: `Dataset '${id}' was not found.` });
        }

        const schemaRef =
          ((ds.schemaRef as Record<string, unknown> | undefined)?.id as string | undefined) ?? null;
        let hasPrimaryIdentity = false;
        if (schemaRef) {
          // Adobe: "You can only delete records from datasets whose associated
          // XDM schema defines a primary identity or identity map."
          const schema = await ctx.client
            .request<Record<string, unknown>>({
              method: "GET",
              path: `/data/foundation/schemaregistry/tenant/schemas/${encodeURIComponent(schemaRef)}`,
              headers: { Accept: "application/vnd.adobe.xed-full+json; version=1" },
            })
            .catch(() => null);
          const text = JSON.stringify(schema ?? {});
          hasPrimaryIdentity =
            /"xdm:isPrimary"\s*:\s*true/.test(text) || /identityMap/.test(text);
        }
        if (!hasPrimaryIdentity) {
          return toolError({
            code: "NO_PRIMARY_IDENTITY",
            message:
              `Dataset '${id}' has no primary identity or identityMap in its schema. Adobe only ` +
              `deletes records from datasets whose XDM schema defines one, so this work order ` +
              `would not do what it appears to. Nothing was submitted.`,
            details: { schemaRef },
          });
        }

        // ---- Gate 3: refuse a dataset with an active expiration ----------
        const ttls = await ctx.client
          .request<unknown>({ method: "GET", path: "/data/core/hygiene/ttl", query: { limit: 100 } })
          .catch(() => null);
        const rows = Array.isArray(ttls)
          ? ttls
          : ((ttls as { results?: unknown[] } | null)?.results ?? []);
        const active = (rows as Array<Record<string, unknown>>).filter(
          (t) =>
            t.datasetId === id &&
            ["pending", "executing"].includes(String(t.status ?? "").toLowerCase()),
        );
        if (active.length) {
          return toolError({
            code: "DATASET_HAS_ACTIVE_EXPIRATION",
            message:
              `Dataset '${id}' has ${active.length} active expiration(s) scheduled. Deleting ` +
              `records from a dataset that is itself scheduled for deletion is almost certainly ` +
              `not the intent — cancel the expiration first, or target a different dataset.`,
            details: { activeExpirations: active.map((t) => t.ttlId ?? t.id) },
          });
        }

        const body: Record<string, unknown> = {
          action: "delete_identity",
          datasetId: id,
          namespacesIdentities: toNamespacesIdentities(identities),
        };
        if (displayName !== undefined) body.displayName = displayName;
        if (description !== undefined) body.description = description;

        const requestSpec = { method: "POST" as const, path: "/data/core/hygiene/workorder", body };

        // ---- dryRun: preflight passed, nothing sent, identities redacted --
        if (dryRun) {
          logger.info({ tool: TOOL_NAME, ...safeSummary }, "DRY RUN — no work order submitted");
          return toolResult({
            dryRun: true,
            sent: false,
            preflight: { schemaRef, hasPrimaryIdentity, activeExpirations: 0 },
            ...safeSummary,
            wouldSend: {
              method: requestSpec.method,
              path: requestSpec.path,
              body: {
                action: "delete_identity",
                datasetId: id,
                namespacesIdentities: namespaceCodes.map((code) => ({
                  namespace: { code },
                  ids: `[${identities.filter((i) => i.namespace === code).length} value(s) REDACTED]`,
                })),
                ...(displayName !== undefined ? { displayName } : {}),
                ...(description !== undefined ? { description } : {}),
              },
            },
            _warning:
              "SUBMISSION IS IRREVERSIBLE. A work order cannot be cancelled once submitted, and " +
              "completion may take up to 30 days (15 with Privacy and Security Shield). Adobe " +
              "reports the action as 'identity-delete' in responses even though the request " +
              "action is 'delete_identity'.",
            _nextStep: `To submit, re-run with dryRun=false and confirm='${confirmPhrase(id, digest)}'.`,
          });
        }

        // ---- Gate 4: confirmation bound to dataset AND identity digest ---
        const expected = confirmPhrase(id, digest);
        if (confirm !== expected) {
          logger.warn(
            { tool: TOOL_NAME, ...safeSummary, confirmProvided: Boolean(confirm) },
            "Record delete rejected: confirmation missing or does not match this dataset and identity set",
          );
          return toolError({
            code: "CONFIRMATION_REQUIRED",
            message:
              `Record deletion is irreversible and cannot be cancelled once submitted. Re-invoke ` +
              `with confirm='${expected}' (exact match). The digest binds the confirmation to this ` +
              `exact identity set, so it becomes invalid if the identities change.`,
          });
        }

        logger.warn(
          { tool: TOOL_NAME, ...safeSummary },
          "DESTRUCTIVE: submitting record delete work order (preflight and confirmation verified)",
        );

        const response = await ctx.client.post<CreateWorkOrderResponse | undefined>(
          requestSpec.path,
          body,
        );

        const workorderId = response?.workorderId;
        const submittedAt = new Date().toISOString();

        logger.info({ tool: TOOL_NAME, datasetId: id, workorderId, submittedAt }, "Work order accepted");

        return toolResult({
          success: true,
          workorderId,
          ...safeSummary,
          submittedAt,
          status: response?.status,
          _warning:
            "Acceptance is not deletion. This CANNOT be cancelled. Adobe's documented statuses " +
            "are received, validated, submitted, ingested, completed, and failed; completion may " +
            "take up to 30 days (15 with Shield).",
          message:
            "Record delete work order accepted. Poll aep_get_work_order_status with the " +
            "workorderId to track it.",
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
