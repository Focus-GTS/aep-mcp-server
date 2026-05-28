import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { SegmentSizeEstimate } from "../../types/aep.js";
import {
  toolResult,
  toolError,
  mapApiError,
  AepApiError,
} from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { describe } from "../../util/metadata.js";

const TOOL_NAME = "aep_estimate_segment_size";
const TOOL_DESCRIPTION =
  "Estimate the qualifying audience size for a segment in the Adobe Experience Platform Unified Profile " +
  "Service. Pass 'segmentId' to estimate an existing segment definition (returns metadata directly from " +
  "the segment definition, which may include 'estimatedSize'), OR pass 'pqlExpression' to preview the size " +
  "of a candidate PQL query without persisting it. At least one of the two must be provided. " +
  "NOTE: The PQL preview flow is asynchronous — it submits a preview, then polls an estimate endpoint up " +
  "to 5 times at 1-second intervals. The call may take several seconds to return while the estimate is " +
  "computed.";

const inputSchema = {
  segmentId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "ID of an existing segment definition to fetch (may include estimatedSize directly)",
    ),
  pqlExpression: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A PQL/text expression to estimate without persisting a segment definition",
    ),
};

interface PreviewResponse {
  previewId?: string;
  id?: string;
  [key: string]: unknown;
}

interface EstimateResponse {
  state?: string;
  status?: string;
  totalProfileSize?: number;
  estimatedSize?: number;
  ttlInDays?: number;
  lastUpdated?: string;
  [key: string]: unknown;
}

interface SegmentDefinitionResponse {
  id?: string;
  name?: string;
  estimatedSize?: number;
  totalProfileSize?: number;
  ttlInDays?: number;
  state?: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

const MAX_POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 1000;
const TERMINAL_STATES = new Set([
  "RESULT_READY",
  "COMPLETED",
  "SUCCESS",
  "READY",
]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Real-Time CDP",
        category: "Segments",
        operation: "execute",
        requiresEntitlement: "Real-Time CDP",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const { segmentId, pqlExpression } = args;

      if (!segmentId && !pqlExpression) {
        return toolError({
          code: "INVALID_INPUT",
          message:
            "Either 'segmentId' or 'pqlExpression' must be provided to estimate segment size.",
        });
      }

      if (segmentId && pqlExpression) {
        return toolError({
          code: "INVALID_INPUT",
          message:
            "Provide only one of 'segmentId' or 'pqlExpression', not both.",
        });
      }

      try {
        // Path 1: by segmentId — fetch the segment definition; it may carry estimatedSize directly.
        if (segmentId) {
          logger.debug(
            { tool: TOOL_NAME, mode: "byId", segmentId },
            "Fetching segment definition for size estimate",
          );

          const definition =
            await ctx.client.request<SegmentDefinitionResponse>({
              method: "GET",
              path: `/data/core/ups/segment/definitions/${encodeURIComponent(segmentId)}`,
            });

          const size =
            definition.estimatedSize ?? definition.totalProfileSize ?? null;

          const result: SegmentSizeEstimate & {
            source: string;
            raw?: unknown;
          } = {
            segmentId,
            totalProfileSize: size ?? 0,
            ttlInDays: definition.ttlInDays ?? 0,
            state: definition.state ?? "UNKNOWN",
            lastUpdated: definition.lastUpdated ?? new Date().toISOString(),
            source: "segmentDefinition",
            raw: definition,
          };

          return toolResult(result);
        }

        // Path 2: by PQL expression — 2-call preview + estimate flow.
        logger.debug(
          { tool: TOOL_NAME, mode: "byExpression" },
          "Submitting preview for segment size estimate",
        );

        const preview = await ctx.client.request<PreviewResponse>({
          method: "POST",
          path: "/data/core/ups/preview",
          body: {
            predicateExpression: pqlExpression,
            predicateType: "pql/text",
          },
        });

        const previewId = preview.previewId ?? preview.id;
        if (!previewId) {
          return toolError({
            code: "PREVIEW_FAILED",
            message:
              "AEP preview endpoint did not return a previewId. Cannot estimate size.",
            details: preview,
          });
        }

        let lastEstimate: EstimateResponse | undefined;
        let lastErr: unknown;

        for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
          if (attempt > 1) await sleep(POLL_INTERVAL_MS);
          try {
            const estimate = await ctx.client.request<EstimateResponse>({
              method: "GET",
              path: `/data/core/ups/estimate/${encodeURIComponent(previewId)}`,
            });
            lastEstimate = estimate;
            const state = (
              estimate.state ??
              estimate.status ??
              ""
            ).toUpperCase();
            if (
              TERMINAL_STATES.has(state) ||
              typeof estimate.totalProfileSize === "number"
            ) {
              break;
            }
          } catch (pollErr) {
            // 404 on early polls is common while the estimate is still being prepared.
            lastErr = pollErr;
            if (pollErr instanceof AepApiError && pollErr.status !== 404) {
              throw pollErr;
            }
          }
        }

        if (!lastEstimate) {
          return toolError({
            code: "ESTIMATE_TIMEOUT",
            message:
              `Preview submitted (previewId=${previewId}) but no estimate was returned after ` +
              `${MAX_POLL_ATTEMPTS} polls. Retry the tool to continue polling.`,
            details: lastErr ? mapApiError(lastErr) : undefined,
          });
        }

        const total =
          lastEstimate.totalProfileSize ?? lastEstimate.estimatedSize ?? 0;

        const result: SegmentSizeEstimate & {
          previewId: string;
          source: string;
          raw?: unknown;
        } = {
          segmentId: previewId,
          previewId,
          totalProfileSize: total,
          ttlInDays: lastEstimate.ttlInDays ?? 0,
          state: lastEstimate.state ?? lastEstimate.status ?? "UNKNOWN",
          lastUpdated: lastEstimate.lastUpdated ?? new Date().toISOString(),
          source: "previewEstimate",
          raw: lastEstimate,
        };

        return toolResult(result);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, err },
          "Failed to estimate segment size",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
