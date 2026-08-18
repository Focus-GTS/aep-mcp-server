import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import type { AjoCampaign } from "../../types/ajo.js";
import { toolResult, toolError, mapApiError, AepApiError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { defineTool } from "../../util/metadata.js";
import { ajoCampaignPath } from "./paths.js";

const TOOL_NAME = "ajo_get_campaign";
const TOOL_DESCRIPTION =
  "Get a single Adobe Journey Optimizer campaign by id, including its state, schedule, channel " +
  "and content references.\n" +
  "\n" +
  "AJO is a SEPARATE Adobe product from Experience Platform and is licensed separately. A 403 or " +
  "a 404 on every id usually means the organization is not entitled to Journey Optimizer.\n" +
  "\n" +
  "A 404 for one specific id means that campaign does not exist, or exists with no published " +
  "version — Adobe distinguishes these with the error code CJMCMP-2044-404, 'The campaign has no " +
  "acceptable version', which this tool surfaces rather than flattening to 'not found'.";

const inputSchema = {
  campaignId: z
    .string()
    .min(1)
    .describe("The AJO campaign id (a UUID, as returned by ajo_list_campaigns)."),
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
      const { campaignId } = args;
      const id = campaignId.trim();
      if (id === "") {
        return toolError({ code: "INVALID_CAMPAIGN_ID", message: "campaignId is blank." });
      }

      try {
        logger.info({ tool: TOOL_NAME, campaignId: id }, "Fetching AJO campaign");
        const campaign = await ctx.client.request<AjoCampaign>({
          method: "GET",
          path: ajoCampaignPath(id),
        });
        logger.info({ tool: TOOL_NAME, campaignId: id, state: campaign?.state }, "AJO campaign fetched");
        return toolResult(campaign);
      } catch (err) {
        // "No acceptable version" is a real, distinct state: the campaign row
        // exists but has never been published, so there is nothing to return.
        // Flattening it into a generic 404 would send someone looking for a
        // campaign that is in fact right there, just unpublished.
        if (err instanceof AepApiError && err.status === 404) {
          const body = err.body as { type?: string; title?: string; message?: string } | undefined;
          const marker = `${body?.type ?? ""} ${body?.title ?? ""} ${body?.message ?? ""}`;
          if (/no acceptable version|CJMCMP-2044/i.test(marker)) {
            logger.info({ tool: TOOL_NAME, campaignId: id }, "Campaign exists but has no published version");
            return toolError({
              code: "CAMPAIGN_HAS_NO_VERSION",
              message:
                `Campaign '${id}' has no acceptable (published) version. The campaign may exist ` +
                `as a draft — this is not the same as the id being unknown. Adobe reports it as ` +
                `CJMCMP-2044-404.`,
            });
          }
        }
        logger.error({ tool: TOOL_NAME, campaignId: id, err }, "Failed to fetch AJO campaign");
        return toolError(mapApiError(err));
      }
    },
  );
}
