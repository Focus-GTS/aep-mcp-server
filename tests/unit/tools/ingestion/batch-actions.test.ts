import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/ingestion/batch-actions.js";

/**
 * ABORT and REVERT, verified against Adobe's Batch Ingestion API docs:
 *   POST /data/foundation/import/batches/{BATCH_ID}?action=ABORT
 *   POST /data/foundation/import/batches/{BATCH_ID}?action=REVERT
 *
 * Action casing is UPPERCASE and load-bearing — a lowercase `abort` would be a
 * different (probably unhandled) request, so it is asserted explicitly.
 */

const ID = "fake0000batch0001";

function harness(returns: unknown = { id: ID }) {
  const request = vi.fn(async () => returns);
  const handlers = new Map<string, any>();
  register(
    {
      registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h),
      tool: (n: string, _d: unknown, _s: unknown, h: any) => handlers.set(n, h),
    } as never,
    {
      client: { request },
      tokenCache: {},
      credentials: {
        clientId: "c", clientSecret: "s",
        orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp",
      },
    } as never,
  );
  return { request, abort: handlers.get("aep_abort_batch")!, revert: handlers.get("aep_revert_batch")! };
}

const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

describe("request shape matches Adobe's documentation", () => {
  it("ABORT posts to the batch id with ?action=ABORT", async () => {
    const { request, abort } = harness();
    await abort({ batchId: ID, dryRun: false }, {});
    const spec = request.mock.calls[0][0] as any;
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe(`/data/foundation/import/batches/${ID}`);
    expect(spec.query).toEqual({ action: "ABORT" });
  });

  it("REVERT posts to the batch id with ?action=REVERT", async () => {
    const { request, revert } = harness();
    await revert({ batchId: ID, dryRun: false, confirm: `REVERT BATCH ${ID}` }, {});
    const spec = request.mock.calls[0][0] as any;
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe(`/data/foundation/import/batches/${ID}`);
    expect(spec.query).toEqual({ action: "REVERT" });
  });

  it("action casing is UPPERCASE, not lowercase", async () => {
    const { request, abort } = harness();
    await abort({ batchId: ID, dryRun: false }, {});
    expect((request.mock.calls[0][0] as any).query.action).toBe("ABORT");
    expect((request.mock.calls[0][0] as any).query.action).not.toBe("abort");
  });

  it("uses the import host path, never catalog", async () => {
    const { request, abort } = harness();
    await abort({ batchId: ID, dryRun: false }, {});
    const spec = request.mock.calls[0][0] as any;
    expect(spec.path).toContain("/data/foundation/import/");
    expect(spec.path).not.toContain("/catalog/");
  });
});

describe("dryRun defaults to true for both", () => {
  it("ABORT sends nothing by default", async () => {
    const { request, abort } = harness();
    const out = await parse(abort({ batchId: ID, dryRun: true }, {}));
    expect(out.sent).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("REVERT sends nothing by default, and needs no confirmation to preview", async () => {
    const { request, revert } = harness();
    const out = await parse(revert({ batchId: ID, dryRun: true }, {}));
    expect(out.sent).toBe(false);
    expect(out.wouldSend.query).toEqual({ action: "REVERT" });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("REVERT requires an id-bound confirmation", () => {
  it("refuses without one", async () => {
    const { request, revert } = harness();
    const out = await parse(revert({ batchId: ID, dryRun: false }, {}));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses a confirmation naming a different batch", async () => {
    const { request, revert } = harness();
    const out = await parse(
      revert({ batchId: ID, dryRun: false, confirm: "REVERT BATCH other-batch" }, {}),
    );
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts the exact phrase", async () => {
    const { request, revert } = harness();
    const out = await parse(revert({ batchId: ID, dryRun: false, confirm: `REVERT BATCH ${ID}` }, {}));
    expect(out.reverted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ABORT does not require confirmation — it is reversible in intent", async () => {
    const { abort } = harness();
    const out = await parse(abort({ batchId: ID, dryRun: false }, {}));
    expect(out.aborted).toBe(true);
  });
});

describe("dangerous batch ids are blocked before any request", () => {
  it.each([["ALL", "ALL"], ["wildcard", "*"], ["blank", "   "], ["path", "../x"]])(
    "refuses %s for both actions",
    async (_l, bad) => {
      const { request, abort, revert } = harness();
      const a = await parse(abort({ batchId: bad, dryRun: false }, {}));
      const r = await parse(revert({ batchId: bad, dryRun: false, confirm: `REVERT BATCH ${bad}` }, {}));
      expect(a.code).toMatch(/INVALID_BATCH_ID|FORBIDDEN_BATCH_ID/);
      expect(r.code).toMatch(/INVALID_BATCH_ID|FORBIDDEN_BATCH_ID/);
      expect(request).not.toHaveBeenCalled();
    },
  );
});

describe("REVERT sets expectations about asynchronous cleanup", () => {
  it("says inactive is the expected immediate state", async () => {
    const { revert } = harness();
    const out = await parse(revert({ batchId: ID, dryRun: false, confirm: `REVERT BATCH ${ID}` }, {}));
    expect(out._note).toMatch(/inactive/i);
    expect(out._note).toMatch(/asynchronous/i);
  });
});

describe("ABORT and REVERT are documented as alternatives, not a sequence", () => {
  it("both descriptions say so, so a model does not chain them", async () => {
    // Verified live 2026-08-15: REVERT on an already-aborted batch returns
    // 428 ERR-BI-104. Adobe's guidance is abort-if-in-progress,
    // revert-if-mastered. The original Phase 2A plan chained them and failed.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/tools/ingestion/batch-actions.ts", "utf8");
    expect(src).toMatch(/ALTERNATIVES, not a sequence/);
    expect(src).toMatch(/428 ERR-BI-104/);
  });
});
