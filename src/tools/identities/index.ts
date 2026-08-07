import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListNamespaces } from "./list-namespaces.js";
import { register as registerGetIdentityGraph } from "./get-identity-graph.js";

/**
 * Register Identity Service tools with the MCP server.
 * Covers namespace discovery and identity graph traversal.
 *
 * NOTE: `aep_get_profile_by_identity` lives in ../profiles/ despite being
 * identity-keyed. It calls the Unified Profile Service access-entities
 * endpoint and returns a profile entity, so it is categorised as a Profiles
 * tool — matching the category its own describe() metadata declares, which is
 * what agents route on.
 */
export function registerIdentityTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerListNamespaces(server, ctx);
  registerGetIdentityGraph(server, ctx);
}
