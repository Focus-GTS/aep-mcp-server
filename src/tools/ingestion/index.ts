import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerCreateBatch } from "./create-batch.js";
import { register as registerUploadBatchFile } from "./upload-batch-file.js";
import { register as registerCompleteBatch } from "./complete-batch.js";
import { register as registerGetBatchStatus } from "./get-batch-status.js";
import { register as registerListBatches } from "./list-batches.js";
import { register as registerBatchActions } from "./batch-actions.js";

export function registerIngestionTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerCreateBatch(server, ctx);
  registerUploadBatchFile(server, ctx);
  registerCompleteBatch(server, ctx);
  registerGetBatchStatus(server, ctx);
  registerListBatches(server, ctx);
  registerBatchActions(server, ctx);
}
