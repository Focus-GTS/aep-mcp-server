import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, PrivacyJob } from "../../types/aep.js";
import { toolResult, toolError, mapApiError, AepApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
  extractPageHints,
} from "../../util/pagination.js";
import { defineTool } from "../../util/metadata.js";
import { logger } from "../../util/logger.js";
import { PRIVACY_REGULATIONS } from "../../types/aep.js";

const TOOL_NAME = "aep_list_privacy_jobs";
const TOOL_DESCRIPTION =
  "List Adobe Privacy Service jobs for a given regulation. The 'regulation' parameter " +
  "is REQUIRED by the Adobe Privacy Service API — jobs cannot be queried across " +
  "regulations in a single call. Optionally filter by status. Returns a paginated " +
  "list of PrivacyJob records.";

const inputSchema = {
  regulation: z
    .enum(PRIVACY_REGULATIONS)
    .describe(
      "Privacy regulation code to list jobs for (e.g. 'gdpr', 'ccpa', 'cpra_usa'). " +
        "REQUIRED by Adobe Privacy Service — calls without this are rejected.",
    ),
  ...paginationSchema,
  status: z
    .enum(["submitted", "processing", "complete", "error", "cancelled"])
    .optional()
    .describe("Optional filter on job status"),
};


/**
 * True when a Privacy Service error is "your query matched nothing" rather than
 * "you may not do this".
 *
 * Privacy Service uses 404 for both an unknown route and an empty result set,
 * so the body is the only thing that separates them.
 */
function isEmptyJobList(err: unknown): boolean {
  if (!(err instanceof AepApiError) || err.status !== 404) return false;
  const body = err.body as
    | { errors?: { detail?: string; title?: string }; detail?: string; title?: string }
    | undefined;
  const text = [
    body?.errors?.detail,
    body?.errors?.title,
    body?.detail,
    body?.title,
  ]
    .filter((x): x is string => typeof x === "string")
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  if (/not authoriz|not entitled|not provisioned|access denied|forbidden/.test(text)) {
    return false;
  }
  return /not able to find|no .*(found|records|results|jobs)/.test(text);
}

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
        product: "Adobe Privacy Service",
        category: "Privacy",
        operation: "read",
        requiresEntitlement: "Adobe Privacy Service",
      },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { regulation, limit, offset, status } = args;

      logger.info(
        { tool: TOOL_NAME, regulation, limit, offset, status },
        "Listing privacy jobs",
      );

      try {
        const response = await ctx.client.request<AepListResponse<PrivacyJob>>({
          method: "GET",
          path: "/data/core/privacy/jobs",
          query: {
            regulation,
            limit,
            // `offset` was previously accepted and silently dropped, so page 2
            // returned page 1 while still reporting offset: 20. Send it as
            // `start`, matching the convention used across the other AEP list
            // endpoints. Where Privacy Service prefers cursor paging, the
            // `nextLink` in the response remains the authoritative path.
            start: offset,
            ...(status ? { status } : {}),
          },
        });

        let results =
          response.results ??
          response.children ??
          response._embedded?.results ??
          [];

        // Client-side status filter as a defensive layer in case the API ignores it.
        if (status) {
          results = results.filter((job) => job.status === status);
        }

        const page = buildPaginatedResponse<PrivacyJob>(
          results,
          { limit, offset },
          extractPageHints(response),
        );

        logger.info(
          {
            tool: TOOL_NAME,
            regulation,
            count: page.count,
            total: page.total,
            hasMore: page.hasMore,
          },
          "Privacy jobs listed",
        );

        return toolResult(page);
      } catch (err) {
        // Privacy Service answers an empty job list with HTTP 404:
        //   {"errors":{"errorCode":404,"title":"Resource not found",
        //              "detail":"Not able to find job data."}}
        // Confirmed live on 2026-08-17 against a tenant with zero jobs.
        //
        // Surfacing that as AEP_404 makes "you have no privacy jobs" — the
        // normal state of most tenants — look like a broken tool, and pushes an
        // agent toward retrying or reporting a failure. An empty list is a
        // successful answer to "list my privacy jobs".
        //
        // The same distinction already existed in scripts/classify-response.mjs
        // for the validation harness; it just never reached the tool. Narrowly
        // scoped on purpose: only a 404 whose body reads as "found nothing".
        // A 404 that reads as "not authorized" or "not provisioned" is still an
        // error, because those need a human, not an empty array.
        if (isEmptyJobList(err)) {
          logger.info(
            { tool: TOOL_NAME, regulation },
            "Privacy Service reported no jobs (404 empty-result) — returning an empty list",
          );
          return toolResult(
            buildPaginatedResponse<PrivacyJob>([], { limit, offset }, {}),
          );
        }

        logger.error(
          { tool: TOOL_NAME, regulation, err },
          "Failed to list privacy jobs",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
