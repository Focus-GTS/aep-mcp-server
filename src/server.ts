#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredentials, inspect } from "./auth/credentials.js";
import { TokenCache } from "./auth/token-cache.js";
import { AepClient } from "./auth/aep-client.js";
import {
  resolveSandbox,
  productionWritesAllowed,
} from "./auth/sandbox-guard.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "./util/logger.js";
import type { ToolContext } from "./types/context.js";

const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../package.json"),
    "utf-8",
  ),
);
const VERSION = pkg.version as string;

// Time allowed for pino transports to flush buffered logs to stderr before
// the process exits. Used by all clean-shutdown and fatal-exit paths.
const SHUTDOWN_FLUSH_MS = 100;

const INSTRUCTIONS = [
  "Adobe Experience Platform (AEP) MCP server. All operations scoped to a single sandbox configured at startup.",
  "Tool descriptions are prefixed with [Product · Category · operation] metadata for routing.",
  "Conventions: inputs validated via zod; errors return as structured tool results (isError: true), never throws;",
  "pagination uses offset/limit — check 'hasMore' for completion; destructive ops (delete-profile) require explicit",
  "confirmation args; some tools require entitlements beyond base AEP (Real-Time CDP, Query Service) — tagged in descriptions.",
  "Recommended schema workflow: aep_list_schemas → aep_create_schema → aep_create_dataset.",
].join(" ");

async function main(): Promise<void> {
  logger.info(`Starting AEP MCP Server v${VERSION}`);

  const credentials = loadCredentials();

  // Surface malformed-looking config BEFORE the IMS call, so operators get
  // "your AEP_ORG_ID looks wrong" instead of an opaque IMS 400. Warn rather
  // than throw: these are format heuristics, and a false positive must not
  // refuse to start a server whose credentials actually work.
  const configProblems = inspect(credentials);
  if (configProblems.length > 0) {
    logger.warn(
      { problems: configProblems },
      "Credential format check found potential problems — continuing to the IMS self-check anyway. " +
        "If authentication fails below, start here.",
    );
  }

  const tokenCache = new TokenCache(credentials);
  const client = new AepClient(credentials, tokenCache);

  try {
    await tokenCache.getToken();
  } catch (err) {
    logger.fatal(
      { err },
      "Startup self-check failed: cannot obtain Adobe IMS token. See .env.example",
    );
    throw new Error(
      "Credential validation failed at startup — see logs and .env.example",
    );
  }

  // Ask Adobe what kind of sandbox we are actually pointed at, and tell the
  // client. Until this lands, the client's write guard treats the sandbox as
  // unknown and blocks every mutation — so a failure here degrades to
  // read-only rather than to unguarded writes.
  const sandboxInfo = await resolveSandbox(client, credentials);
  client.setSandboxInfo(sandboxInfo);

  if (sandboxInfo.type === "development") {
    logger.info(
      { sandbox: sandboxInfo.name, type: sandboxInfo.type },
      "Sandbox is a development sandbox — write operations are ENABLED",
    );
  } else if (productionWritesAllowed()) {
    logger.warn(
      { sandbox: sandboxInfo.name, type: sandboxInfo.type },
      "AEP_ALLOW_PRODUCTION_WRITES is set — write operations are ENABLED against a " +
        "non-development sandbox. This override was requested explicitly.",
    );
  } else {
    logger.warn(
      {
        sandbox: sandboxInfo.name,
        type: sandboxInfo.type,
        reason: sandboxInfo.reason,
      },
      sandboxInfo.type === "production"
        ? "Sandbox is PRODUCTION — write operations are BLOCKED. Reads work normally."
        : "Sandbox type could not be confirmed — write operations are BLOCKED (fail-closed). Reads work normally.",
    );
  }

  const ctx: ToolContext = { client, tokenCache, credentials };
  const server = new McpServer(
    { name: "aep-mcp-server", version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  registerAllTools(server, ctx);

  const exit = (code: number): void => {
    logger.flush();
    setTimeout(() => process.exit(code), SHUTDOWN_FLUSH_MS).unref();
  };
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received, closing server");
    try {
      await server.close();
    } catch (err) {
      logger.error({ err }, "Error during server close");
    }
    exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.fatal(
      { err, type: "uncaughtException" },
      "Uncaught exception, exiting",
    );
    exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal(
      { err: reason, type: "unhandledRejection" },
      "Unhandled rejection, exiting",
    );
    exit(1);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    {
      sandbox: credentials.sandboxName,
      sandboxType: sandboxInfo.type,
      writesEnabled:
        sandboxInfo.type === "development" || productionWritesAllowed(),
      org: credentials.orgId,
      version: VERSION,
    },
    "AEP MCP Server connected and ready",
  );
}

main().catch((err) => {
  logger.fatal(err, "Failed to start AEP MCP Server");
  process.exit(1);
});
