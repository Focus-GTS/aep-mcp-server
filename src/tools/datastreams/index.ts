import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListDatastreams } from "./list-datastreams.js";
import { register as registerGetDatastream } from "./get-datastream.js";
import { register as registerCreateDatastream } from "./create-datastream.js";
import { register as registerUpdateDatastream } from "./update-datastream.js";
import { register as registerDeleteDatastream } from "./delete-datastream.js";

export function registerDatastreamTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerListDatastreams(server, ctx);
  registerGetDatastream(server, ctx);
  registerCreateDatastream(server, ctx);
  registerUpdateDatastream(server, ctx);
  registerDeleteDatastream(server, ctx);
}
