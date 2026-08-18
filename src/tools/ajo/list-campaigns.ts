import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AjoCampaign, AjoListResponse } from "../../types/ajo.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";
import { AJO_CAMPAIGNS_PATH } from "./paths.js";

const TOOL_NAME = "ajo_list_campaigns";
const TOOL_DESCRIPTION =
  "List Adobe Journey Optimizer campaigns in the current sandbox. Returns each campaign's id, " +
  "name, state, schedule and channel, with paging metadata.\n" +
  "\n" +
  "AJO is a SEPARATE Adobe product from Experience Platform and is licensed separately. If this " +
  "returns 403 or 404, the credential's organization is most likely not entitled to Journey " +
  "Optimizer — that is not a fault in the request.\n" +
  "\n" +
  "Paging is 1-based via `page`, with `count` as the page size — NOT limit/offset, which the rest " +
  "of this server uses. That is Adobe's shape for this endpoint, not a local inconsistency.";

const inputSchema = {
  count: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(50)
    .describe("Page size (1–50). Adobe's default is 50."),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .describe("1-based page number. Adobe's paging here is page/count, not limit/offset."),
  orderBy: z
    .string()
    .optional()
    .describe(
      "Sort field, e.g. 'name' or '-modifiedAt'. A leading '-' reverses the order. " +
        "Adobe defaults to 'name'.",
    ),
  full: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, ask Adobe for the full campaign representation rather than the list summary. " +
        "Heavier responses; leave false unless you need the detail for every row.",
    ),
};

export function register(server: McpServer, ctx: ToolContext): void {
  defineTool(
    server,
    TOOL_NAME,
    {
      product: "Adobe Journey Optimizer",
      category: "Campaigns",
      operation: "read",
      requiresEntitlement: "Adobe Journey Optimizer",
    },
    TOOL_DESCRIPTION,
    inputSchema,
    async (args) => {
      const { count, page, orderBy, full } = args;
      try {
        logger.info({ tool: TOOL_NAME, count, page, orderBy, full }, "Listing AJO campaigns");

        const response = await ctx.client.request<AjoListResponse<AjoCampaign>>({
          method: "GET",
          path: AJO_CAMPAIGNS_PATH,
          query: {
            count,
            page,
            ...(orderBy ? { orderby: orderBy } : {}),
            ...(full ? { full: true } : {}),
          },
        });

        const campaigns = response.data ?? [];
        const pageInfo = response._page ?? {};

        logger.info(
          { tool: TOOL_NAME, returned: campaigns.length, totalCount: pageInfo.totalCount },
          "AJO campaigns listed",
        );

        return toolResult({
          campaigns,
          count: campaigns.length,
          page: pageInfo.page ?? page,
          pageSize: pageInfo.count ?? count,
          totalCount: pageInfo.totalCount ?? null,
          totalPages: pageInfo.totalPages ?? null,
          hasMore:
            pageInfo.totalPages !== undefined && pageInfo.page !== undefined
              ? pageInfo.page < pageInfo.totalPages
              : false,
        });
      } catch (err) {
        logger.error({ tool: TOOL_NAME, err }, "Failed to list AJO campaigns");
        return toolError(mapApiError(err));
      }
    },
  );
}
