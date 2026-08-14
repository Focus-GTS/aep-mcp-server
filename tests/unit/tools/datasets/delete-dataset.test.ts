import { describe, it, expect, vi } from "vitest";
import {
  register,
  inspectDataset,
  verifyDeleteResponse,
} from "../../../../src/tools/datasets/delete-dataset.js";

/**
 * Mock-only. No live calls, fake ids throughout.
 *
 * The load-bearing assertions are the ones proving a DELETE never leaves the
 * process: every refusal is checked with `expect(request).not.toHaveBeenCalled()`
 * or by asserting no DELETE appears among the calls made.
 */

const FAKE_ID = "fake0000dataset0001";
const OTHER_ID = "fake0000dataset0002";
const CONFIRM = `DELETE DATASET ${FAKE_ID}`;

/** A plain, caller-created dataset — the only kind this tool should delete. */
const PLAIN = {
  name: "mcpval-2026-08-14-abc-phase1",
  schemaRef: { id: "https://ns.adobe.com/tenant/schemas/xyz" },
  tags: {},
};

function harness(opts: { getReturns?: unknown; deleteReturns?: unknown } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const request = vi.fn(async (spec: any) => {
    calls.push({ method: spec.method, path: spec.path });
    if (spec.method === "DELETE") return opts.deleteReturns ?? [`@/dataSets/${FAKE_ID}`];
    return opts.getReturns ?? { [FAKE_ID]: PLAIN };
  });
  const get = vi.fn(async (path: string) => {
    calls.push({ method: "GET", path });
    return opts.getReturns ?? { [FAKE_ID]: PLAIN };
  });

  const handlers = new Map<string, any>();
  register(
    {
      registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h),
      tool: (n: string, _d: unknown, _s: unknown, h: any) => handlers.set(n, h),
    } as never,
    {
      client: { request, get },
      tokenCache: {},
      credentials: {
        clientId: "c", clientSecret: "s",
        orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp",
      },
    } as never,
  );

  const handler = handlers.get("aep_delete_dataset")!;
  const deletes = () => calls.filter((c) => c.method === "DELETE");
  return { request, get, calls, deletes, handler };
}

const call = (h: any, a: Record<string, unknown>) =>
  h({ dryRun: false, allowProfileEnabled: false, ...a }, {});
const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

// ---------------------------------------------------------------- id gates

describe("dangerous ids are blocked before the network layer", () => {
  it.each([
    ["ALL", "ALL"],
    ["all lowercase", "all"],
    ["asterisk wildcard", "*"],
    ["the string null", "null"],
    ["the string undefined", "undefined"],
  ])("refuses %s", async (_label, id) => {
    const { handler, request, get } = harness();
    const out = await parse(call(handler, { datasetId: id, confirm: `DELETE DATASET ${id}` }));
    expect(out.code).toBe("FORBIDDEN_DATASET_ID");
    expect(request).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses a blank id", async () => {
    const { handler, request } = harness();
    const out = await parse(call(handler, { datasetId: "   ", confirm: "DELETE DATASET " }));
    expect(out.code).toBe("INVALID_DATASET_ID");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ["a path traversal", "../../dataSets"],
    ["a glob", "fake*"],
    ["a name with spaces", "my dataset"],
    ["a query string", "id?limit=1"],
  ])("refuses %s", async (_label, id) => {
    const { handler, request } = harness();
    const out = await parse(call(handler, { datasetId: id, confirm: `DELETE DATASET ${id}` }));
    expect(out.code).toBe("INVALID_DATASET_ID");
    expect(request).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------ confirmation

describe("confirmation is bound to the specific dataset id", () => {
  it("refuses when confirm is omitted", async () => {
    const { handler, deletes } = harness();
    const out = await parse(call(handler, { datasetId: FAKE_ID }));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(deletes()).toHaveLength(0);
  });

  it("refuses a generic confirmation phrase", async () => {
    const { handler, deletes } = harness();
    const out = await parse(
      call(handler, { datasetId: FAKE_ID, confirm: "I understand this is irreversible" }),
    );
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(deletes()).toHaveLength(0);
  });

  it("refuses a confirmation naming a DIFFERENT dataset — the copy-paste case", async () => {
    const { handler, deletes } = harness();
    const out = await parse(
      call(handler, { datasetId: FAKE_ID, confirm: `DELETE DATASET ${OTHER_ID}` }),
    );
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(deletes()).toHaveLength(0);
  });

  it("accepts the exact bound confirmation", async () => {
    const { handler, deletes } = harness();
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.deleted).toBe(true);
    expect(deletes()).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ dryRun

describe("dryRun sends zero DELETE requests", () => {
  it("issues no DELETE", async () => {
    const { handler, deletes } = harness();
    await call(handler, { datasetId: FAKE_ID, dryRun: true });
    expect(deletes()).toHaveLength(0);
  });

  it("returns sent:false explicitly", async () => {
    const { handler } = harness();
    const out = await parse(call(handler, { datasetId: FAKE_ID, dryRun: true }));
    expect(out.sent).toBe(false);
    expect(out.dryRun).toBe(true);
  });

  it("still runs the preflight GET, and reports what it found", async () => {
    const { handler, calls } = harness();
    const out = await parse(call(handler, { datasetId: FAKE_ID, dryRun: true }));
    expect(calls.some((c) => c.method === "GET")).toBe(true);
    expect(out.preflight.name).toBe("mcpval-2026-08-14-abc-phase1");
    expect(out.preflight.profileEnabled).toBe(false);
  });

  it("shows the DELETE it would send", async () => {
    const { handler } = harness();
    const out = await parse(call(handler, { datasetId: FAKE_ID, dryRun: true }));
    expect(out.wouldSend).toEqual({
      method: "DELETE",
      path: `/data/foundation/catalog/dataSets/${FAKE_ID}`,
    });
  });

  it("needs no confirmation, because nothing is deleted", async () => {
    const { handler } = harness();
    const out = await parse(call(handler, { datasetId: FAKE_ID, dryRun: true }));
    expect(out.code).toBeUndefined();
  });
});

// --------------------------------------------------------------- preflight

describe("preflight refuses datasets we should not touch", () => {
  it("refuses a Profile-enabled dataset by default", async () => {
    const { handler, deletes } = harness({
      getReturns: { [FAKE_ID]: { ...PLAIN, tags: { unifiedProfile: ["enabled:true"] } } },
    });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("REFUSED_PROFILE_ENABLED");
    expect(deletes()).toHaveLength(0);
  });

  it("permits a Profile-enabled dataset only with the explicit escape hatch", async () => {
    const { handler, deletes } = harness({
      getReturns: { [FAKE_ID]: { ...PLAIN, tags: { unifiedProfile: ["enabled:true"] } } },
    });
    const out = await parse(
      call(handler, { datasetId: FAKE_ID, confirm: CONFIRM, allowProfileEnabled: true }),
    );
    expect(out.deleted).toBe(true);
    expect(deletes()).toHaveLength(1);
  });

  it.each([
    ["isSystemDataset flag", { ...PLAIN, isSystemDataset: true }],
    ["an underscore-prefixed name", { ...PLAIN, name: "_internal_dataset" }],
    ["a managedBy marker", { ...PLAIN, managedBy: "AJO" }],
    ["a siphon-managed tag", { ...PLAIN, tags: { "aep/siphon/managed": ["true"] } }],
  ])("refuses a system/application-managed dataset (%s)", async (_l, raw) => {
    const { handler, deletes } = harness({ getReturns: { [FAKE_ID]: raw } });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("REFUSED_SYSTEM_DATASET");
    expect(deletes()).toHaveLength(0);
  });

  it("refuses when the dataset does not exist", async () => {
    const { handler, deletes } = harness({ getReturns: {} });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("DATASET_NOT_FOUND");
    expect(deletes()).toHaveLength(0);
  });

  it("never resolves the target by name — the GET uses the exact id", async () => {
    const { handler, calls } = harness();
    await call(handler, { datasetId: FAKE_ID, confirm: CONFIRM });
    const get = calls.find((c) => c.method === "GET")!;
    expect(get.path).toBe(`/data/foundation/catalog/dataSets/${FAKE_ID}`);
    expect(get.path).not.toContain("mcpval");
  });
});

// --------------------------------------------------- response verification

describe("HTTP 200 alone is not success", () => {
  it("rejects Adobe's 200-with-empty-array as NOT deleted", async () => {
    const { handler } = harness({ deleteReturns: [] });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("DELETE_NOT_CONFIRMED");
    expect(out.message).toMatch(/EMPTY array/i);
  });

  it("rejects a response naming a different dataset", async () => {
    const { handler } = harness({ deleteReturns: [`@/dataSets/${OTHER_ID}`] });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("DELETE_NOT_CONFIRMED");
  });

  it("rejects a response with more than one path", async () => {
    const { handler } = harness({
      deleteReturns: [`@/dataSets/${FAKE_ID}`, `@/dataSets/${OTHER_ID}`],
    });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("DELETE_NOT_CONFIRMED");
  });

  it("rejects a non-array response", async () => {
    const { handler } = harness({ deleteReturns: { ok: true } });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.code).toBe("DELETE_NOT_CONFIRMED");
  });

  it("accepts exactly ['@/dataSets/<id>']", async () => {
    const { handler } = harness({ deleteReturns: [`@/dataSets/${FAKE_ID}`] });
    const out = await parse(call(handler, { datasetId: FAKE_ID, confirm: CONFIRM }));
    expect(out.deleted).toBe(true);
    expect(out.confirmedBy).toBe(`@/dataSets/${FAKE_ID}`);
  });
});

// ------------------------------------------------------------ pure helpers

describe("verifyDeleteResponse", () => {
  it.each([
    [[], "empty"],
    [{}, "object"],
    [null, "null"],
    [["@/dataSets/other"], "wrong id"],
  ])("rejects %s", (resp) => {
    expect(verifyDeleteResponse(resp, FAKE_ID).ok).toBe(false);
  });

  it("accepts the exact expected path", () => {
    expect(verifyDeleteResponse([`@/dataSets/${FAKE_ID}`], FAKE_ID).ok).toBe(true);
  });
});

describe("inspectDataset", () => {
  it("detects Profile enablement from unifiedProfile tags", () => {
    expect(inspectDataset({ tags: { unifiedProfile: ["enabled:true"] } }).profileEnabled).toBe(true);
  });

  it("detects Profile enablement from unifiedIdentity tags", () => {
    expect(inspectDataset({ tags: { unifiedIdentity: ["enabled:true"] } }).profileEnabled).toBe(true);
  });

  it("reports a plain dataset as neither system nor Profile-enabled", () => {
    const i = inspectDataset(PLAIN);
    expect(i.profileEnabled).toBe(false);
    expect(i.systemManaged).toBe(false);
    expect(i.schemaRef).toBe("https://ns.adobe.com/tenant/schemas/xyz");
  });
});
