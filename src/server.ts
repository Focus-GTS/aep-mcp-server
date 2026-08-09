#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredentials, inspect } from "./auth/credentials.js";
import { TokenCache } from "./auth/token-cache.js";
import { AepClient } from "./auth/aep-client.js";
import { resolveSandbox, resolveWriteMode } from "./auth/sandbox-guard.js";
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

  // Try to authenticate, but do NOT exit on failure.
  //
  // This used to be fatal. That was wrong for an MCP server: the client could
  // not complete a handshake or call tools/list without working Adobe
  // credentials, so there was no way to inspect what the server offers before
  // configuring it — and a server that exits during startup looks to most MCP
  // clients like an opaque crash rather than "your credentials are wrong".
  //
  // Auth failures are already reported per call as structured AEP_AUTH_*
  // errors, which is a far clearer place for them to surface. Starting anyway
  // also lets registries and inspectors verify the server with placeholder
  // credentials, which is how they check a server is installable at all.
  //
  // Nothing is weakened by continuing: without a token every request fails at
  // the Adobe boundary, and sandbox resolution below fails closed, so writes
  // stay blocked.
  let authOk = false;
  try {
    await tokenCache.getToken();
    authOk = true;
    logger.info("Adobe IMS authentication succeeded");
  } catch (err) {
    logger.warn(
      { err },
      "Adobe IMS authentication FAILED at startup — the server is running and will " +
        "list its tools, but every tool call will fail until credentials are fixed. " +
        "Check AEP_CLIENT_ID / AEP_CLIENT_SECRET / AEP_ORG_ID against .env.example.",
    );
  }

  // Ask Adobe what kind of sandbox we are actually pointed at, and tell the
  // client. Until this lands, the client's write guard treats the sandbox as
  // unknown — which `safe` mode blocks — so a failure here degrades to
  // read-only rather than to unguarded writes.
  const sandboxInfo = await resolveSandbox(client, credentials);
  client.setSandboxInfo(sandboxInfo);

  const { mode, viaLegacyFlag, invalidValue } = resolveWriteMode();

  if (invalidValue) {
    logger.warn(
      { provided: invalidValue, using: mode },
      `AEP_MODE value not recognised — falling back to '${mode}'. ` +
        "Valid values are: read-only, safe, production.",
    );
  }
  if (viaLegacyFlag) {
    logger.warn(
      {},
      "AEP_ALLOW_PRODUCTION_WRITES is deprecated — use AEP_MODE=production instead. " +
        "The legacy flag still works and has selected production mode.",
    );
  }

  const writesEnabled =
    mode === "production" ||
    (mode === "safe" && sandboxInfo.type === "development");

  const modeLog = {
    mode,
    sandbox: sandboxInfo.name,
    sandboxType: sandboxInfo.type,
    writesEnabled,
    ...(sandboxInfo.reason ? { reason: sandboxInfo.reason } : {}),
  };

  if (mode === "production") {
    logger.warn(
      modeLog,
      "PRODUCTION MODE — writes, updates, and deletes are permitted against ANY sandbox, " +
        "including production. Sandbox-type protection is disabled by operator choice.",
    );
  } else if (mode === "read-only") {
    logger.info(
      modeLog,
      "READ-ONLY MODE — no write, update, or delete will be performed in any sandbox.",
    );
  } else if (sandboxInfo.type === "development") {
    logger.info(
      modeLog,
      "SAFE MODE — sandbox is a development sandbox, so writes are ENABLED.",
    );
  } else {
    logger.warn(
      modeLog,
      sandboxInfo.type === "production"
        ? "SAFE MODE — sandbox is PRODUCTION, so writes are BLOCKED. Reads work normally."
        : "SAFE MODE — sandbox type could not be confirmed, so writes are BLOCKED (fail-closed). Reads work normally.",
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
      mode,
      writesEnabled,
      authenticated: authOk,
      org: credentials.orgId,
      version: VERSION,
    },
    authOk
      ? "AEP MCP Server connected and ready"
      : "AEP MCP Server connected — tools are listed but UNAUTHENTICATED; calls will fail until credentials are fixed",
  );
}

main().catch((err) => {
  logger.fatal(err, "Failed to start AEP MCP Server");
  process.exit(1);
});
