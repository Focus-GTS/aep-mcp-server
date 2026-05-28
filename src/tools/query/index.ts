import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerRunQuery } from "./run-query.js";
import { register as registerGetQueryStatus } from "./get-query-status.js";
import { register as registerListQueries } from "./list-queries.js";

export function registerQueryTools(server: McpServer, ctx: ToolContext): void {
  registerRunQuery(server, ctx);
  registerGetQueryStatus(server, ctx);
  registerListQueries(server, ctx);
}
