import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListNamespaces } from "./list-namespaces.js";
import { register as registerGetIdentityGraph } from "./get-identity-graph.js";
import { register as registerGetProfileByIdentity } from "./get-profile-by-identity.js";

/**
 * Register Identity Service tools with the MCP server.
 * Covers namespace discovery, identity graph traversal, and identity-keyed profile lookup.
 */
export function registerIdentityTools(server: McpServer, ctx: ToolContext): void {
  registerListNamespaces(server, ctx);
  registerGetIdentityGraph(server, ctx);
  registerGetProfileByIdentity(server, ctx);
}
