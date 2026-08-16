import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";

/**
 * Read-only Data Lifecycle quota.
 *
 * GET /data/core/hygiene/quota
 *
 * Worth having before any destructive Data Lifecycle work: record deletes and
 * dataset expirations both consume a metered allowance, and discovering the
 * ceiling by hitting it is an expensive way to learn.
 */
const TOOL_NAME = "aep_get_data_lifecycle_quota";

const QUOTA_TYPES = [
  "datasetExpirationQuota",
  "dailyConsumerDeleteIdentitiesQuota",
  "monthlyConsumerDeleteIdentitiesQuota",
] as const;

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    { product: "Adobe Experience Platform", category: "Data Hygiene", operation: "read" },
    "Read Adobe Experience Platform Data Lifecycle quota usage and entitlement.\n" +
      "\n" +
      "GET /data/core/hygiene/quota\n" +
      "\n" +
      "Optionally filter with quotaType: datasetExpirationQuota, " +
      "dailyConsumerDeleteIdentitiesQuota, or monthlyConsumerDeleteIdentitiesQuota.\n" +
      "\n" +
      "Read-only. Check this before planning record deletes or expirations at volume — both " +
      "consume a metered allowance.",
    {
      quotaType: z
        .enum(QUOTA_TYPES)
        .optional()
        .describe("Optional filter. Omit to return every quota type."),
    },
    async (args) => {
      try {
        const response = await ctx.client.request<unknown>({
          method: "GET",
          path: "/data/core/hygiene/quota",
          ...(args.quotaType ? { query: { quotaType: args.quotaType } } : {}),
        });
        logger.debug({ tool: TOOL_NAME, quotaType: args.quotaType }, "Read Data Lifecycle quota");
        return toolResult({
          quotaType: args.quotaType ?? "(all)",
          quota: response ?? null,
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Quota read failed");
        return toolError(mapApiError(err));
      }
    },
  );
}
