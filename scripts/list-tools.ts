#!/usr/bin/env tsx
/**
 * Lists all registered tools by category. Run with: npm run tools
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../src/tools/index.js";
import type { ToolContext } from "../src/types/context.js";

// Stub a ToolContext — we never call handlers, just collect registrations
const ctx = {} as ToolContext;

// Capture all tool registrations
const registered: Array<{ name: string; description: string }> = [];

// Wrap server.tool to spy on registrations
class SpyServer {
  tool(name: string, description: string, _schema: unknown, _handler: unknown): void {
    registered.push({ name, description });
  }
}

const spy = new SpyServer() as unknown as McpServer;
registerAllTools(spy, ctx);

// Group by category (parsed from description prefix [Product · Category · op])
const byCategory = new Map<string, Array<{ name: string; op: string }>>();
for (const { name, description } of registered) {
  const match = description.match(/^\[([^\]]+)\]/);
  const header = match?.[1] ?? "Uncategorized";
  const parts = header.split("·").map((s) => s.trim());
  const category = parts[1] ?? "Uncategorized";
  const op = parts[2] ?? "?";
  if (!byCategory.has(category)) byCategory.set(category, []);
  byCategory.get(category)!.push({ name, op });
}

const sortedCategories = [...byCategory.keys()].sort();

console.log(`\n@focusgts/aep-mcp-server — ${registered.length} tools available\n`);
for (const category of sortedCategories) {
  const tools = byCategory.get(category)!;
  console.log(`  ${category} (${tools.length})`);
  for (const { name, op } of tools.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`    ${name.padEnd(38)} ${op}`);
  }
  console.log();
}
