import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../types/context.js";
import { register as registerCreatePrivacyJob } from "./create-privacy-job.js";
import { register as registerGetPrivacyJob } from "./get-privacy-job.js";
import { register as registerListPrivacyJobs } from "./list-privacy-jobs.js";
import { register as registerCancelPrivacyJob } from "./cancel-privacy-job.js";
import { register as registerGetPrivacyJobResults } from "./get-privacy-job-results.js";
import { register as registerListPrivacyNamespaces } from "./list-privacy-namespaces.js";

export function registerPrivacyTools(
  server: McpServer,
  ctx: ToolContext,
): void {
  registerCreatePrivacyJob(server, ctx);
  registerGetPrivacyJob(server, ctx);
  registerListPrivacyJobs(server, ctx);
  registerCancelPrivacyJob(server, ctx);
  registerGetPrivacyJobResults(server, ctx);
  registerListPrivacyNamespaces(server, ctx);
}
