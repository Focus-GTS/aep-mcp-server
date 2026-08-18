import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { annotationsFor } from "../../../src/util/metadata.js";
import { registerAllTools } from "../../../src/tools/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../../../src/types/context.js";

describe("annotationsFor", () => {
  const base = {
    product: "Adobe Experience Platform",
    category: "Schemas",
  } as const;

  it("marks read operations readOnly and idempotent", () => {
    const a = annotationsFor({ ...base, operation: "read" });
    expect(a.readOnlyHint).toBe(true);
    expect(a.destructiveHint).toBe(false);
    expect(a.idempotentHint).toBe(true);
  });

  it("marks write operations as mutating but not destructive", () => {
    const a = annotationsFor({ ...base, operation: "write" });
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
  });

  it("marks delete operations destructive by default", () => {
    const a = annotationsFor({ ...base, operation: "delete" });
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(true);
  });

  it("lets explicit `destructive` override the operation default", () => {
    // A write that is in fact destructive (e.g. scheduling data expiry).
    const a = annotationsFor({
      ...base,
      operation: "write",
      destructive: true,
    });
    expect(a.destructiveHint).toBe(true);
  });

  it("never marks a read destructive, even if flagged", () => {
    // Defensive: a read cannot destroy anything, so the client should not be
    // prompted as though it might.
    const a = annotationsFor({
      ...base,
      operation: "read",
      destructive: true,
    });
    expect(a.destructiveHint).toBe(false);
  });

  it("marks every tool openWorld — they all call a live external system", () => {
    for (const op of ["read", "write", "delete", "execute"] as const) {
      expect(annotationsFor({ ...base, operation: op }).openWorldHint).toBe(
        true,
      );
    }
  });
});

interface Registered {
  name: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

function registerAll(): Registered[] {
  const tools: Registered[] = [];
  const server = {
    registerTool: (
      name: string,
      config: { annotations?: Registered["annotations"] },
    ) => {
      tools.push({ name, annotations: config.annotations });
    },
    // Present so a regression to the deprecated API is caught loudly rather
    // than silently producing an un-annotated tool.
    tool: (name: string) => {
      tools.push({ name, annotations: undefined });
    },
  } as unknown as McpServer;

  registerAllTools(server, {
    client: {},
    tokenCache: {},
    credentials: {
      clientId: "x",
      clientSecret: "y",
      orgId: "z@AdobeOrg",
      sandboxName: "dev",
    },
  } as unknown as ToolContext);

  return tools;
}

describe("every registered tool carries annotations", () => {
  const tools = registerAll();

  it("registers the full tool surface", () => {
    expect(tools.length).toBe(51);
  });

  it("leaves no tool on the deprecated un-annotated path", () => {
    const missing = tools.filter((t) => t.annotations === undefined);
    expect(missing.map((t) => t.name)).toEqual([]);
  });

  it("annotates exactly the eight destructive tools", () => {
    // If a new destructive tool is added, add it here deliberately — this
    // list existing is the point. A client uses destructiveHint to decide
    // when to interrupt and ask the human.
    const destructive = tools
      .filter((t) => t.annotations?.destructiveHint)
      .map((t) => t.name)
      .sort();

    expect(destructive).toEqual([
      "aep_cancel_dataset_expiration",
      "aep_create_dataset_expiration",
      "aep_create_record_delete",
      "aep_delete_dataset",
      "aep_delete_profile",
      "aep_delete_segment",
      "aep_revert_batch",
      "aep_update_dataset_expiration",
    ]);
  });

  it("never marks a read-only tool destructive", () => {
    const contradictory = tools.filter(
      (t) => t.annotations?.readOnlyHint && t.annotations?.destructiveHint,
    );
    expect(contradictory.map((t) => t.name)).toEqual([]);
  });

  it("marks the obvious readers read-only", () => {
    for (const name of [
      "aep_list_schemas",
      "aep_get_schema",
      "aep_list_datasets",
      "aep_list_batches",
      "aep_list_work_orders",
    ]) {
      const t = tools.find((x) => x.name === name);
      expect(t, `${name} should be registered`).toBeDefined();
      expect(t?.annotations?.readOnlyHint, name).toBe(true);
    }
  });

  it("does not mark mutating tools read-only", () => {
    for (const name of [
      "aep_create_batch",
      "aep_upload_batch_file",
      "aep_create_schema",
      "aep_update_schema",
      "aep_activate_segment",
    ]) {
      const t = tools.find((x) => x.name === name);
      expect(t, `${name} should be registered`).toBeDefined();
      expect(t?.annotations?.readOnlyHint, name).toBe(false);
    }
  });
});

describe("the validation matrix matches the real registry", () => {
  // Added 2026-08-16. A release report claimed four datastream tools; the
  // registry has five. The matrix had collapsed `update` and `delete` onto one
  // row, and the count was then taken from the rows rather than the tools.
  //
  // Nobody can hold 48 tool names in their head, so the document drifts and
  // the drift is invisible. This asserts the two agree by name, not by count —
  // a count matching is not evidence the right tools are listed.
  const tools = registerAll();
  const matrix = readFileSync(
    new URL("../../../docs/VALIDATION-MATRIX.md", import.meta.url),
    "utf8",
  );
  // Matches every tool prefix, not just `aep_`. AJO tools use `ajo_` because
  // Journey Optimizer is a separate Adobe product with separate licensing, and
  // a name that hides that makes entitlement failures harder to read. A regex
  // pinned to one prefix would silently stop checking the newer surface.
  const documented = new Set(
    [...matrix.matchAll(/`((?:aep|ajo)_[a-z_]+)`/g)].map((m) => m[1]),
  );

  it("documents every registered tool", () => {
    const undocumented = tools
      .map((t) => t.name)
      .filter((n) => !documented.has(n))
      .sort();
    expect(undocumented).toEqual([]);
  });

  it("documents no tool that is not registered", () => {
    const registered = new Set(tools.map((t) => t.name));
    const phantom = [...documented].filter((n) => !registered.has(n)).sort();
    expect(phantom).toEqual([]);
  });

  it("states the correct total in its opening line", () => {
    const stated = matrix.match(/Status of all (\d+) tools/);
    expect(stated).not.toBeNull();
    expect(Number(stated![1])).toBe(tools.length);
  });

  it("registers no datastream tools, and the matrix documents none", () => {
    // Removed in 0.9.0. They called /data/core/edge/datastreams on
    // platform.adobe.io, which returns an HTML 404 on every tenant — the
    // gateway has no such route, so no entitlement could ever have made them
    // work. Datastream configuration lives on Reactor, behind the Experience
    // Platform Launch API. This asserts they stay gone until rewritten there,
    // rather than being restored from git history against the dead path.
    expect(tools.filter((t) => t.name.includes("datastream"))).toEqual([]);
    expect(matrix).not.toMatch(/## Datastreams \(\d+\)/);
  });
});
