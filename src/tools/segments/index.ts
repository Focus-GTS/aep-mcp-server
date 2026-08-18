import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerListSegments } from "./list-segments.js";
import { register as registerGetSegment } from "./get-segment.js";
import { register as registerCreateSegment } from "./create-segment.js";
import { register as registerEstimateSegmentSize } from "./estimate-segment-size.js";
import { register as registerDeleteSegment } from "./delete-segment.js";

export function registerSegmentTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerListSegments(server, ctx);
  registerGetSegment(server, ctx);
  registerCreateSegment(server, ctx);
  registerEstimateSegmentSize(server, ctx);
  registerDeleteSegment(server, ctx);
}
