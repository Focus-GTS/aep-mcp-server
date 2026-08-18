import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListCampaigns } from "./list-campaigns.js";
import { register as registerGetCampaign } from "./get-campaign.js";

/**
 * Adobe Journey Optimizer tools.
 *
 * Read-only, and deliberately narrow. A live probe on 2026-08-18 found that
 * campaigns is the ONLY AJO surface reachable on this tenant — journeys,
 * messages, channel surfaces, content templates, fragments, offers and
 * decisions all return an HTML 404, meaning the gateway has no such route.
 * See paths.ts for the full probe table.
 *
 * Campaign writes (create / update / publish / delete) are not implemented.
 * The routes exist, but nothing here has been exercised against a real campaign
 * — this sandbox contains none — and shipping an unvalidated write path against
 * a marketing product that sends messages to real people is not a trade worth
 * making. They come when there is a campaign to test against.
 */
export function registerAjoTools(server: McpServer, ctx: ToolContext): void {
  registerListCampaigns(server, ctx);
  registerGetCampaign(server, ctx);
}
