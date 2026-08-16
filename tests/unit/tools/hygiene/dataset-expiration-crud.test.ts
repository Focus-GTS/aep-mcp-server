import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/hygiene/dataset-expiration-crud.js";

/**
 * Contract verified against Adobe's Dataset Expiration API, 2026-08-16:
 *   GET    /ttl/{ttlId|datasetId}         (+ ?include=history)
 *   PUT    /ttl/{ttlId}                   ttlId ONLY
 *   DELETE /ttl/{ttlId|datasetId}
 * Update and cancel are valid only while status is 'pending'.
 */

const TTL = "SD-c1f902aa-57cb-412e-bb2b-c70b8e1a5f45".replace(/-/g, "");
const PENDING = { ttlId: TTL, datasetId: "ds1", status: "pending", expiry: "2035-12-31T00:00:00Z" };

function harness(getSeq: Array<() => unknown>) {
  let i = 0;
  const calls: Array<{ method: string; path: string; query?: unknown; body?: unknown }> = [];
  const request = vi.fn(async (spec: any) => {
    calls.push({ method: spec.method, path: spec.path, query: spec.query, body: spec.body });
    if (spec.method === "GET") { const s = getSeq[Math.min(i, getSeq.length - 1)]; i++; return s(); }
    return {};
  });
  const handlers = new Map<string, any>();
  register(
    {
      registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h),
      tool: (n: string, _d: unknown, _s: unknown, h: any) => handlers.set(n, h),
    } as never,
    { client: { request }, tokenCache: {},
      credentials: { clientId: "c", clientSecret: "s", orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp" } } as never,
  );
  return { calls, request, handlers,
    writes: () => calls.filter((c) => c.method !== "GET") };
}
const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

describe("GET expiration", () => {
  it("reads by id and reports pending", async () => {
    const h = harness([() => PENDING]);
    const out = await parse(h.handlers.get("aep_get_dataset_expiration")({ id: TTL, includeHistory: false }, {}));
    expect(h.calls[0].path).toBe(`/data/core/hygiene/ttl/${TTL}`);
    expect(out.status).toBe("pending");
    expect(out._note).toMatch(/can still be updated or cancelled/);
  });

  it("appends ?include=history only when asked", async () => {
    const h = harness([() => ({ ...PENDING, history: [{ change: "created" }] })]);
    await h.handlers.get("aep_get_dataset_expiration")({ id: TTL, includeHistory: true }, {});
    expect(h.calls[0].query).toEqual({ include: "history" });
  });
});

describe("UPDATE is pending-only and dry by default", () => {
  const upd = (h: any, a: Record<string, unknown>) =>
    h.handlers.get("aep_update_dataset_expiration")({ ttlId: TTL, dryRun: false, ...a }, {});

  it("dryRun sends nothing and shows a PUT", async () => {
    const h = harness([() => PENDING]);
    const out = await parse(h.handlers.get("aep_update_dataset_expiration")(
      { ttlId: TTL, dryRun: true, expiry: "2036-12-31T00:00:00Z" }, {}));
    expect(out.sent).toBe(false);
    expect(out.wouldSend.method).toBe("PUT");
    expect(out.wouldSend.path).toBe(`/data/core/hygiene/ttl/${TTL}`);
    expect(h.writes()).toHaveLength(0);
  });

  it("requires the id-bound confirmation", async () => {
    const h = harness([() => PENDING]);
    const out = await parse(upd(h, { expiry: "2036-12-31T00:00:00Z", confirm: "yes" }));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(h.writes()).toHaveLength(0);
  });

  it("refuses when nothing would change", async () => {
    const h = harness([() => PENDING]);
    const out = await parse(upd(h, { confirm: `UPDATE DATASET EXPIRATION ${TTL}` }));
    expect(out.code).toBe("NOTHING_TO_UPDATE");
  });

  it.each(["executing", "cancelled", "completed"])("refuses when status is %s", async (status) => {
    const h = harness([() => ({ ...PENDING, status })]);
    const out = await parse(upd(h, { expiry: "2036-12-31T00:00:00Z", confirm: `UPDATE DATASET EXPIRATION ${TTL}` }));
    expect(out.code).toBe("NOT_PENDING");
    expect(h.writes()).toHaveLength(0);
  });

  it("updates when pending and confirms via a follow-up GET", async () => {
    const h = harness([() => PENDING, () => ({ ...PENDING, expiry: "2036-12-31T00:00:00Z" })]);
    const out = await parse(upd(h, { expiry: "2036-12-31T00:00:00Z", confirm: `UPDATE DATASET EXPIRATION ${TTL}` }));
    expect(out.updated).toBe(true);
    expect(out.changeConfirmedByGet).toBe(true);
    expect(h.writes()[0].method).toBe("PUT");
  });

  it("warns when the follow-up GET does not reflect the change", async () => {
    const h = harness([() => PENDING, () => PENDING]);
    const out = await parse(upd(h, { expiry: "2036-12-31T00:00:00Z", confirm: `UPDATE DATASET EXPIRATION ${TTL}` }));
    expect(out.changeConfirmedByGet).toBe(false);
    expect(out._warning).toBeTruthy();
  });
});

describe("CANCEL is pending-only and GET-confirmed", () => {
  const cancel = (h: any, a: Record<string, unknown> = {}) =>
    h.handlers.get("aep_cancel_dataset_expiration")({ id: TTL, dryRun: false, ...a }, {});

  it("dryRun sends nothing and shows a DELETE", async () => {
    const h = harness([() => PENDING]);
    const out = await parse(h.handlers.get("aep_cancel_dataset_expiration")({ id: TTL, dryRun: true }, {}));
    expect(out.sent).toBe(false);
    expect(out.wouldSend.method).toBe("DELETE");
    expect(h.writes()).toHaveLength(0);
  });

  it("requires the id-bound confirmation", async () => {
    const h = harness([() => PENDING]);
    const out = await parse(cancel(h, { confirm: "CANCEL DATASET EXPIRATION other" }));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(h.writes()).toHaveLength(0);
  });

  it("refuses a non-pending expiration", async () => {
    const h = harness([() => ({ ...PENDING, status: "completed" })]);
    const out = await parse(cancel(h, { confirm: `CANCEL DATASET EXPIRATION ${TTL}` }));
    expect(out.code).toBe("NOT_PENDING");
    expect(h.writes()).toHaveLength(0);
  });

  it("confirms cancellation only when the follow-up GET says cancelled", async () => {
    const h = harness([() => PENDING, () => ({ ...PENDING, status: "cancelled" })]);
    const out = await parse(cancel(h, { confirm: `CANCEL DATASET EXPIRATION ${TTL}` }));
    expect(out.cancelled).toBe(true);
    expect(out.statusAfter).toBe("cancelled");
  });

  it("reports NOT confirmed when the GET still says pending — a 200 is not enough", async () => {
    const h = harness([() => PENDING, () => PENDING]);
    const out = await parse(cancel(h, { confirm: `CANCEL DATASET EXPIRATION ${TTL}` }));
    expect(out.code).toBe("CANCEL_NOT_CONFIRMED");
    expect(out.message).toMatch(/STILL SCHEDULED/);
  });
});

describe("dangerous ids are refused everywhere", () => {
  it.each([["ALL", "ALL"], ["wildcard", "*"], ["blank", "  "], ["path", "../x"]])(
    "refuses %s", async (_l, bad) => {
      const h = harness([() => PENDING]);
      for (const [tool, key] of [
        ["aep_get_dataset_expiration", "id"],
        ["aep_update_dataset_expiration", "ttlId"],
        ["aep_cancel_dataset_expiration", "id"],
      ] as const) {
        const out = await parse(h.handlers.get(tool)({ [key]: bad, dryRun: false, expiry: "2036-12-31T00:00:00Z", confirm: "x" }, {}));
        expect(out.code).toMatch(/INVALID_ID|FORBIDDEN_ID/);
      }
      expect(h.writes()).toHaveLength(0);
    },
  );
});

describe("create sends displayName, which Adobe requires", () => {
  it("includes displayName in the body", async () => {
    const mod = await import("../../../../src/tools/hygiene/create-dataset-expiration.js");
    const { z } = await import("zod");
    const handlers = new Map<string, any>();
    let shape: any;
    mod.register(
      { registerTool: (n: string, m: any, h: any) => { shape = m.inputSchema; handlers.set(n, h); }, tool: () => {} } as never,
      { client: { request: async () => ({}) }, tokenCache: {},
        credentials: { clientId: "c", clientSecret: "s", orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp" } } as never,
    );
    const out = JSON.parse((await handlers.get("aep_create_dataset_expiration")(
      z.object(shape).parse({ datasetId: "ds1", expiry: "2035-12-31T00:00:00Z", displayName: "n", dryRun: true }), {},
    )).content[0].text);
    expect(out.wouldSend.body.displayName).toBe("n");
    expect(out.wouldSend.body.datasetId).toBe("ds1");
    expect(out.sent).toBe(false);
  });

  it("displayName is required by the schema", async () => {
    const mod = await import("../../../../src/tools/hygiene/create-dataset-expiration.js");
    const { z } = await import("zod");
    let shape: any;
    mod.register(
      { registerTool: (_n: string, m: any) => { shape = m.inputSchema; }, tool: () => {} } as never,
      { client: { request: async () => ({}) }, tokenCache: {},
        credentials: { clientId: "c", clientSecret: "s", orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp" } } as never,
    );
    expect(() => z.object(shape).parse({ datasetId: "ds1", expiry: "2035-12-31T00:00:00Z" })).toThrow();
  });
});
