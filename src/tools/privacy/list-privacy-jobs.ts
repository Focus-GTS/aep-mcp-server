import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AepListResponse, PrivacyJob } from "../../types/aep.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import {
  paginationSchema,
  buildPaginatedResponse,
} from "../../util/pagination.js";
import { describe } from "../../util/metadata.js";
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

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Privacy Service",
        category: "Privacy",
        operation: "read",
        requiresEntitlement: "Adobe Privacy Service",
      },
      TOOL_DESCRIPTION,
    ),
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

        const total =
          response.count ?? response.total ?? results.length + offset;

        logger.info(
          { tool: TOOL_NAME, regulation, count: results.length, total },
          "Privacy jobs listed",
        );

        return toolResult(
          buildPaginatedResponse<PrivacyJob>(results, total, { limit, offset }),
        );
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, regulation, err },
          "Failed to list privacy jobs",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
