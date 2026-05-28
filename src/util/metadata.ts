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
  | "AEP Query Service";

export type ToolCategory =
  | "Schemas"
  | "Datasets"
  | "Identities"
  | "Profiles"
  | "Segments"
  | "Sources"
  | "Destinations"
  | "Query Service"
  | "Sandboxes";

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
