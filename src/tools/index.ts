import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../types/context.js";
import { registerSchemaTools } from "./schemas/index.js";
import { registerDatasetTools } from "./datasets/index.js";
import { registerIdentityTools } from "./identities/index.js";
import { registerProfileTools } from "./profiles/index.js";
import { registerSegmentTools } from "./segments/index.js";
import { registerSourceTools } from "./sources/index.js";
import { registerDestinationTools } from "./destinations/index.js";
import { registerQueryTools } from "./query/index.js";
import { registerPrivacyTools } from "./privacy/index.js";

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerSchemaTools(server, ctx);
  registerDatasetTools(server, ctx);
  registerIdentityTools(server, ctx);
  registerProfileTools(server, ctx);
  registerSegmentTools(server, ctx);
  registerSourceTools(server, ctx);
  registerDestinationTools(server, ctx);
  registerQueryTools(server, ctx);
  registerPrivacyTools(server, ctx);
}
