import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListSchemas } from "./list-schemas.js";
import { register as registerGetSchema } from "./get-schema.js";
import { register as registerCreateSchema } from "./create-schema.js";
import { register as registerUpdateSchema } from "./update-schema.js";

export function registerSchemaTools(server: McpServer, ctx: ToolContext): void {
  registerListSchemas(server, ctx);
  registerGetSchema(server, ctx);
  registerCreateSchema(server, ctx);
  registerUpdateSchema(server, ctx);
}
