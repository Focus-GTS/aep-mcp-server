import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListDestinations } from "./list-destinations.js";
import { register as registerActivateSegment } from "./activate-segment.js";

export function registerDestinationTools(server: McpServer, ctx: ToolContext): void {
  registerListDestinations(server, ctx);
  registerActivateSegment(server, ctx);
}
