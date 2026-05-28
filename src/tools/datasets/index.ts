import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListDatasets } from "./list-datasets.js";
import { register as registerGetDataset } from "./get-dataset.js";
import { register as registerCreateDataset } from "./create-dataset.js";

export function registerDatasetTools(server: McpServer, ctx: ToolContext): void {
  registerListDatasets(server, ctx);
  registerGetDataset(server, ctx);
  registerCreateDataset(server, ctx);
}
