import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerCreateRecordDelete } from "./create-record-delete.js";
import { register as registerGetWorkOrderStatus } from "./get-work-order-status.js";
import { register as registerListWorkOrders } from "./list-work-orders.js";
import { register as registerCreateDatasetExpiration } from "./create-dataset-expiration.js";
import { register as registerListDatasetExpirations } from "./list-dataset-expirations.js";
import { register as registerExpirationCrud } from "./dataset-expiration-crud.js";
import { register as registerQuota } from "./get-quota.js";

export function registerHygieneTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerCreateRecordDelete(server, ctx);
  registerGetWorkOrderStatus(server, ctx);
  registerListWorkOrders(server, ctx);
  registerCreateDatasetExpiration(server, ctx);
  registerListDatasetExpirations(server, ctx);
  registerExpirationCrud(server, ctx);
  registerQuota(server, ctx);
}
