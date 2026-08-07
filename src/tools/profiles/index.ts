import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerGetProfile } from "./get-profile.js";
import { register as registerPreviewProfile } from "./preview-profile.js";
import { register as registerDeleteProfile } from "./delete-profile.js";
import { register as registerGetProfileByIdentity } from "./get-profile-by-identity.js";

/**
 * Register Unified Profile Service (UPS) tools with the MCP server.
 * Covers full profile retrieval, identity-keyed lookup, lightweight previews,
 * and destructive deletion.
 */
export function registerProfileTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerGetProfile(server, ctx);
  registerGetProfileByIdentity(server, ctx);
  registerPreviewProfile(server, ctx);
  registerDeleteProfile(server, ctx);
}
