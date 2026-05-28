#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredentials } from "./auth/credentials.js";
import { TokenCache } from "./auth/token-cache.js";
import { AepClient } from "./auth/aep-client.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "./util/logger.js";
import type { ToolContext } from "./types/context.js";

async function main(): Promise<void> {
  logger.info("Starting AEP MCP Server v0.1.0");

  const credentials = loadCredentials();
  const tokenCache = new TokenCache(credentials);
  const client = new AepClient(credentials, tokenCache);

  const ctx: ToolContext = { client, tokenCache, credentials };

  const server = new McpServer(
    { name: "aep-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerAllTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    { sandbox: credentials.sandboxName, org: credentials.orgId },
    "AEP MCP Server connected and ready",
  );
}

main().catch((err) => {
  logger.fatal(err, "Failed to start AEP MCP Server");
  process.exit(1);
});
