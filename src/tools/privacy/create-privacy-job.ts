import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { toolResult, toolError, mapApiError } from "../../util/errors.js";
import { describe } from "../../util/metadata.js";
import { logger } from "../../util/logger.js";
import { PRIVACY_REGULATIONS } from "../../types/aep.js";

const TOOL_NAME = "aep_create_privacy_job";
const TOOL_DESCRIPTION =
  "Submit a new privacy job to the Adobe Privacy Service for GDPR/CCPA/CPRA/etc. data " +
  "subject requests (access or delete). Adobe Privacy Service coordinates processing " +
  "across Adobe products (Experience Platform, Analytics, Audience Manager, etc.) on " +
  "behalf of the company.\n" +
  "\n" +
  "Required fields: 'regulation' (jurisdiction code), 'companyContexts' (company-level " +
  "identifiers such as imsOrgID), and 'users' (one or more user records each carrying " +
  "an internal key, requested action(s), and identity values).\n" +
  "\n" +
  "The response contains a requestId plus per-user jobIds that can be tracked via " +
  "aep_get_privacy_job, aep_get_privacy_job_results, or cancelled via " +
  "aep_cancel_privacy_job while still pending.";

const inputSchema = {
  regulation: z
    .enum(PRIVACY_REGULATIONS)
    .describe(
      "Privacy regulation code under which the request is being made (e.g. 'gdpr', " +
        "'ccpa', 'cpra_usa', 'vcdpa_va_usa'). Must be one of the codes supported by " +
        "Adobe Privacy Service.",
    ),
  companyContexts: z
    .array(
      z.object({
        namespace: z.string(),
        value: z.string(),
      }),
    )
    .min(1)
    .describe(
      "Company-level identifiers — e.g. [{ namespace: 'imsOrgID', value: 'YOUR_ORG@AdobeOrg' }]",
    ),
  users: z
    .array(
      z.object({
        key: z.string().describe("Internal user reference key"),
        action: z.array(z.enum(["delete", "access"])).min(1),
        userIDs: z
          .array(
            z.object({
              namespace: z.string(),
              value: z.string(),
              type: z.enum(["standard", "custom"]).optional(),
              isDeletedClientSide: z.boolean().optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1)
    .describe(
      "Users to process — each with action(s) and identity values",
    ),
  include: z
    .array(z.string())
    .optional()
    .describe(
      "Adobe product names to include (e.g., ['AdobeCloudPlatform', 'Analytics', " +
        "'AudienceManager']). Defaults to all entitled products.",
    ),
  priority: z.enum(["normal", "low"]).optional(),
  analyticsDeleteMethod: z
    .enum(["anonymize", "purge"])
    .optional()
    .describe(
      "How Adobe Analytics handles deletion. anonymize keeps event data minus " +
        "identifiers; purge removes events entirely.",
    ),
};

interface CreatePrivacyJobResponse {
  requestId?: string;
  jobs?: Array<{
    jobId?: string;
    customer?: { user?: { key?: string } };
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export function register(server: McpServer, ctx: ToolContext): void {
  server.tool(
    TOOL_NAME,
    describe(
      {
        product: "Adobe Privacy Service",
        category: "Privacy",
        operation: "write",
        requiresEntitlement: "Adobe Privacy Service",
      },
      TOOL_DESCRIPTION,
    ),
    inputSchema,
    async (args) => {
      const {
        regulation,
        companyContexts,
        users,
        include,
        priority,
        analyticsDeleteMethod,
      } = args;

      logger.info(
        {
          tool: TOOL_NAME,
          regulation,
          userCount: users.length,
          companyContextCount: companyContexts.length,
        },
        "Submitting privacy job",
      );

      try {
        const body: Record<string, unknown> = {
          regulation,
          companyContexts,
          users,
        };
        if (include !== undefined) body.include = include;
        if (priority !== undefined) body.priority = priority;
        if (analyticsDeleteMethod !== undefined) {
          body.analyticsDeleteMethod = analyticsDeleteMethod;
        }

        const response = await ctx.client.post<CreatePrivacyJobResponse>(
          "/data/core/privacy/jobs",
          body,
        );

        logger.info(
          {
            tool: TOOL_NAME,
            requestId: response?.requestId,
            jobCount: response?.jobs?.length ?? 0,
          },
          "Privacy job accepted",
        );

        return toolResult(response);
      } catch (err) {
        logger.error(
          { tool: TOOL_NAME, regulation, err },
          "Failed to submit privacy job",
        );
        return toolError(mapApiError(err));
      }
    },
  );
}
