import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

/**
 * Adobe MCP ecosystem-compatible metadata tagging for tool descriptions.
 *
 * Adobe's first-party MCP servers (AJO, CJA, AEM, Commerce, Marketo) prefix
 * tool descriptions with structured product/category metadata so that agents
 * routing across multiple Adobe MCPs can categorize and filter tools. This
 * helper matches that convention.
 */

export type AdobeProduct =
  | "Adobe Experience Platform"
  | "Adobe Real-Time CDP"
  | "Adobe Journey Optimizer"
  | "Customer Journey Analytics"
  | "AEP Query Service"
  | "Adobe Privacy Service";

export type ToolCategory =
  | "Schemas"
  | "Datasets"
  | "Identities"
  | "Profiles"
  | "Segments"
  | "Sources"
  | "Destinations"
  | "Query Service"
  | "Sandboxes"
  | "Privacy"
  | "Datastreams"
  | "Ingestion"
  | "Data Hygiene";

export type ToolOperation = "read" | "write" | "delete" | "execute";

export interface ToolMetadata {
  product: AdobeProduct;
  category: ToolCategory;
  operation: ToolOperation;
  sandboxScoped?: boolean;
  requiresEntitlement?: string;
  destructive?: boolean;
}

/**
 * Builds a description string with Adobe-compatible metadata header.
 *
 * Format mirrors Adobe's first-party MCP servers: a single-line bracketed
 * prefix followed by the human-readable description, optionally followed by
 * a metadata footer with entitlement/safety notes.
 */
export function describe(meta: ToolMetadata, description: string): string {
  const sandbox = meta.sandboxScoped !== false ? " · Sandbox-scoped" : "";
  const header = `[${meta.product} · ${meta.category} · ${meta.operation}${sandbox}]`;

  const lines: string[] = [header, "", description];

  const footer: string[] = [];
  if (meta.requiresEntitlement) {
    footer.push(`Requires entitlement: ${meta.requiresEntitlement}`);
  }
  if (meta.destructive) {
    footer.push("DESTRUCTIVE: this operation cannot be undone.");
  }
  if (footer.length > 0) {
    lines.push("", footer.join(" "));
  }

  return lines.join("\n");
}

/**
 * MCP tool annotations, derived from the metadata each tool already declares.
 *
 * These are behavioural hints for the CLIENT, not enforcement — the server's
 * own guards do the enforcing. Their value is that an MCP client such as
 * Claude Desktop uses them to decide when to interrupt and ask the human
 * before a call. Without them every tool looks identical to the client, so
 * `aep_delete_profile` gets the same treatment as `aep_list_schemas`.
 *
 * Mapping:
 *   read    -> readOnlyHint, idempotent
 *   write   -> mutating; idempotent for PUT-shaped replacement, not for
 *              create-shaped operations (we cannot tell from metadata alone,
 *              so we do not claim idempotency)
 *   delete  -> destructiveHint
 *   execute -> mutating, non-idempotent, not destructive
 *
 * `openWorldHint` is true for every tool: they all reach a live external
 * system (Adobe) whose contents this server does not control.
 */
export interface ToolAnnotationHints {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export function annotationsFor(
  meta: ToolMetadata,
  title?: string,
): ToolAnnotationHints {
  const isRead = meta.operation === "read";

  // `destructive` on the metadata is authoritative when set; otherwise a
  // delete operation is destructive by definition.
  const destructive = meta.destructive ?? meta.operation === "delete";

  return {
    ...(title ? { title } : {}),
    readOnlyHint: isRead,
    // Only meaningful for non-read tools; clients ignore it on read-only ones.
    destructiveHint: isRead ? false : destructive,
    idempotentHint: isRead ? true : false,
    openWorldHint: true,
  };
}

/**
 * Registers a tool with both the Adobe-style description header and the MCP
 * annotations derived from the same metadata, so the two can never drift.
 *
 * Replaces the deprecated `server.tool(name, description, schema, handler)`
 * form, which cannot carry annotations.
 *
 * Generic over the Zod input shape and typed against the SDK's own
 * `ToolCallback<S>`, so handlers keep full parameter inference — `args` stays
 * strongly typed rather than degrading to `any`.
 */
export function defineTool<S extends ZodRawShapeCompat>(
  server: McpServer,
  name: string,
  meta: ToolMetadata,
  description: string,
  inputSchema: S,
  handler: ToolCallback<S>,
): void {
  server.registerTool(
    name,
    {
      description: describe(meta, description),
      inputSchema,
      annotations: annotationsFor(meta),
    },
    handler,
  );
}
