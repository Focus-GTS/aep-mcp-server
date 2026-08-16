import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/hygiene/create-record-delete.js";

/**
 * Hardening for the one tool this project has deliberately never executed.
 * The properties that matter most: identity values never leave the process in
 * any output, and `ALL` is refused.
 *
 * Rewritten 2026-08-16. The previous version of this file asserted the
 * contract that hardening removed:
 *
 *   - it passed `datasetId: "ALL"` in every case, because the schema used to
 *     tell the model "Pass the literal 'ALL' to delete the identities from
 *     EVERY dataset in the sandbox". In a shared sandbox that reaches other
 *     tenants' data, so `ALL` is now refused outright.
 *   - it accepted a generic confirmation phrase ("I understand this is
 *     irreversible") that named neither the dataset nor the identities, so a
 *     confirmation approved for one deletion authorised any other.
 *
 * Those tests passed. They were testing the wrong contract.
 */

const DS = "fake0000dataset01";
const EMAIL = "synthetic.person@example.invalid";
const IDS = [{ namespace: "email", id: EMAIL }];

const SCHEMA_WITH_PK = { title: "s", "xdm:isPrimary": true, properties: { a: { "xdm:isPrimary": true } } };

function harness(opts: { dataset?: unknown; schema?: unknown; ttls?: unknown } = {}) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const request = vi.fn(async (spec: any) => {
    calls.push({ method: spec.method, path: spec.path, body: spec.body });
    if (spec.path.includes("/schemaregistry/")) return opts.schema ?? SCHEMA_WITH_PK;
    if (spec.path.includes("/hygiene/ttl")) return opts.ttls ?? { results: [] };
    return {};
  });
  const get = vi.fn(async (path: string) => {
    calls.push({ method: "GET", path });
    return opts.dataset ?? { [DS]: { name: "ds", schemaRef: { id: "https://ns.adobe.com/t/schemas/x" } } };
  });
  const post = vi.fn(async (path: string, body: unknown) => {
    calls.push({ method: "POST", path, body });
    return { workorderId: "wo-1", status: "received" };
  });
  const handlers = new Map<string, any>();
  register(
    { registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h), tool: () => {} } as never,
    { client: { request, get, post }, tokenCache: {},
      credentials: { clientId: "c", clientSecret: "s", orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "dev-sandbox" } } as never,
  );
  return { calls, post, handler: handlers.get("aep_create_record_delete")!,
    writes: () => calls.filter((c) => c.method === "POST" && c.path.includes("workorder")) };
}
const run = (h: any, a: Record<string, unknown> = {}) =>
  h({ datasetId: DS, identities: IDS, dryRun: true, ...a }, {});
const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

describe("identity values never leave the process", () => {
  it("the dry run does not contain the email anywhere", async () => {
    const h = harness();
    const raw = JSON.stringify(await run(h.handler));
    expect(raw).not.toContain(EMAIL);
    expect(raw).toMatch(/REDACTED/);
  });

  it("a confirmation failure does not echo the email", async () => {
    const h = harness();
    const raw = JSON.stringify(await run(h.handler, { dryRun: false, confirm: "wrong" }));
    expect(raw).not.toContain(EMAIL);
  });

  it("reports counts, namespaces, and a digest instead", async () => {
    const out = await parse(run(harness().handler));
    expect(out.identityCount).toBe(1);
    expect(out.namespaces).toEqual(["email"]);
    expect(out.identityDigest).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("ALL and multi-dataset targets are refused", () => {
  it.each([["ALL", "ALL"], ["lowercase all", "all"], ["wildcard", "*"], ["prod", "prod"], ["production", "production"]])(
    "refuses %s", async (_l, datasetId) => {
      const h = harness();
      const out = await parse(run(h.handler, { datasetId, dryRun: false, confirm: "x" }));
      expect(out.code).toBe("FORBIDDEN_DATASET_ID");
      expect(h.writes()).toHaveLength(0);
    });

  it("refuses a comma-separated list", async () => {
    const h = harness();
    const out = await parse(run(h.handler, { datasetId: "a,b", dryRun: false, confirm: "x" }));
    expect(out.code).toBe("MULTIPLE_DATASETS");
    expect(h.writes()).toHaveLength(0);
  });

  it("refuses blank and malformed ids", async () => {
    for (const bad of ["   ", "../x", "a b"]) {
      const h = harness();
      const out = await parse(run(h.handler, { datasetId: bad, dryRun: false, confirm: "x" }));
      expect(out.code).toMatch(/INVALID_DATASET_ID|FORBIDDEN_DATASET_ID/);
      expect(h.writes()).toHaveLength(0);
    }
  });
});

describe("preflight", () => {
  it("refuses a dataset whose schema has no primary identity", async () => {
    const h = harness({ schema: { title: "no-pk", properties: {} } });
    const out = await parse(run(h.handler, { dryRun: false, confirm: "x" }));
    expect(out.code).toBe("NO_PRIMARY_IDENTITY");
    expect(h.writes()).toHaveLength(0);
  });

  it("accepts an identityMap schema", async () => {
    const h = harness({ schema: { properties: { identityMap: {} } } });
    const out = await parse(run(h.handler));
    expect(out.dryRun).toBe(true);
    expect(out.preflight.hasPrimaryIdentity).toBe(true);
  });

  it("refuses a dataset with an active expiration", async () => {
    const h = harness({ ttls: { results: [{ ttlId: "SD-1", datasetId: DS, status: "pending" }] } });
    const out = await parse(run(h.handler, { dryRun: false, confirm: "x" }));
    expect(out.code).toBe("DATASET_HAS_ACTIVE_EXPIRATION");
    expect(h.writes()).toHaveLength(0);
  });

  it("ignores a cancelled expiration on the same dataset", async () => {
    const h = harness({ ttls: { results: [{ ttlId: "SD-1", datasetId: DS, status: "cancelled" }] } });
    const out = await parse(run(h.handler));
    expect(out.dryRun).toBe(true);
  });

  it("refuses a dataset that does not exist", async () => {
    const h = harness({ dataset: {} });
    const out = await parse(run(h.handler));
    expect(out.code).toBe("DATASET_NOT_FOUND");
  });
});

describe("dryRun and the digest-bound confirmation", () => {
  it("dryRun defaults true and submits nothing", async () => {
    const h = harness();
    const out = await parse(run(h.handler));
    expect(out.sent).toBe(false);
    expect(h.writes()).toHaveLength(0);
  });

  it("states that submission is irreversible and may take 30 days", async () => {
    const out = await parse(run(harness().handler));
    expect(out._warning).toMatch(/IRREVERSIBLE/i);
    expect(out._warning).toMatch(/cannot be cancelled/i);
    expect(out._warning).toMatch(/30 days/);
    expect(out._warning).toMatch(/identity-delete/);
  });

  it("refuses a confirmation that omits the digest", async () => {
    const h = harness();
    const out = await parse(run(h.handler, { dryRun: false, confirm: `DELETE RECORDS ${DS}` }));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(h.writes()).toHaveLength(0);
  });

  it("a confirmation for a DIFFERENT identity set is refused", async () => {
    const h = harness();
    const other = await parse(run(h.handler, { identities: [{ namespace: "email", id: "other@example.invalid" }] }));
    const out = await parse(run(h.handler, {
      dryRun: false, confirm: `DELETE RECORDS ${DS} ${other.identityDigest}`,
    }));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(h.writes()).toHaveLength(0);
  });

  it("submits only with the exact dataset+digest confirmation", async () => {
    const h = harness();
    const dry = await parse(run(h.handler));
    const out = await parse(run(h.handler, {
      dryRun: false, confirm: `DELETE RECORDS ${DS} ${dry.identityDigest}`,
    }));
    expect(out.success).toBe(true);
    expect(h.writes()).toHaveLength(1);
    expect((h.writes()[0].body as any).action).toBe("delete_identity");
    expect((h.writes()[0].body as any).namespacesIdentities[0].namespace.code).toBe("email");
  });

  it("the digest is order-independent", async () => {
    const a = [{ namespace: "email", id: "x@y.invalid" }, { namespace: "ECID", id: "1" }];
    const d1 = await parse(run(harness().handler, { identities: a }));
    const d2 = await parse(run(harness().handler, { identities: [...a].reverse() }));
    expect(d1.identityDigest).toBe(d2.identityDigest);
  });
});

describe("registration", () => {
  it("registers as aep_create_record_delete and declares itself destructive", () => {
    const calls: Array<{ name: string; config: any }> = [];
    register(
      { registerTool: (name: string, config: any) => calls.push({ name, config }), tool: () => {} } as never,
      { client: {}, tokenCache: {}, credentials: {} } as never,
    );
    expect(calls[0].name).toBe("aep_create_record_delete");
    expect(calls[0].config.description).toContain("DESTRUCTIVE");
    expect(calls[0].config.annotations?.destructiveHint).toBe(true);
  });

  it("tells the model ALL is refused, rather than offering it as a mode", () => {
    // The schema is the only thing the model reads before calling. It used to
    // say "Pass the literal 'ALL' to delete the identities from every dataset
    // in the sandbox" — an instruction. It must now read as a prohibition.
    const calls: Array<{ config: any }> = [];
    register(
      { registerTool: (_n: string, config: any) => calls.push({ config }), tool: () => {} } as never,
      { client: {}, tokenCache: {}, credentials: {} } as never,
    );
    const described = calls[0].config.inputSchema.datasetId._def.description as string;
    expect(described).toMatch(/REFUSED/);
    expect(described).toMatch(/EXACT id of the single dataset/);
    expect(described).not.toMatch(/pass (the literal )?'?ALL'?/i);
  });
});
