import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListSources } from "./list-sources.js";
import { register as registerListDataflows } from "./list-dataflows.js";

export function registerSourceTools(server: McpServer, ctx: ToolContext): void {
  registerListSources(server, ctx);
  registerListDataflows(server, ctx);
}
