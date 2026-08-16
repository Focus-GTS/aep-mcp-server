import { describe, it, expect, vi } from "vitest";
import { register, verifyGone } from "../../../../src/tools/datasets/delete-dataset.js";

/**
 * The deletion state machine.
 *
 * Central principle: a GET returning 404 is the ONLY authority on whether the
 * dataset is gone. The DELETE response body is classified and reported, but
 * never decides the outcome — because an unverified assumption about that
 * body's shape would make the tool report failure for a deletion that really
 * happened, sending someone to chase an orphan that does not exist.
 */

const ID = "fake0000dataset0001";
const CONFIRM = `DELETE DATASET ${ID}`;
const PLAIN = { name: "mcpval-2026-08-14-abc-phase1", tags: {} };

class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); }
}

/**
 * @param deleteBehaviour  what each DELETE attempt does, in order
 * @param getSequence      what each verification GET does, in order
 */
function harness(deleteBehaviour: Array<() => unknown>, getSequence: Array<() => unknown>) {
  let deleteIdx = 0;
  let getIdx = 0;
  const deleteCalls: number[] = [];

  const preflight = () => ({ [ID]: PLAIN });

  const get = vi.fn(async () => {
    // First call is the preflight; the rest are verification.
    if (getIdx === 0) { getIdx++; return preflight(); }
    const step = getSequence[Math.min(getIdx - 1, getSequence.length - 1)];
    getIdx++;
    return step();
  });

  const request = vi.fn(async (spec: any) => {
    if (spec.method !== "DELETE") return preflight();
    deleteCalls.push(Date.now());
    const step = deleteBehaviour[Math.min(deleteIdx, deleteBehaviour.length - 1)];
    deleteIdx++;
    return step();
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
        orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "dev-sandbox",
      },
    } as never,
    async () => {}, // no real waiting
  );

  return { handler: handlers.get("aep_delete_dataset")!, deleteCount: () => deleteCalls.length };
}

const GONE = () => { throw new HttpError(404); };
const STILL_THERE = () => ({ [ID]: PLAIN });
const run = (h: any) => h({ datasetId: ID, confirm: CONFIRM, dryRun: false, allowProfileEnabled: false }, {});
const parse = async (p: Promise<any>) => JSON.parse((await p).content[0].text);

describe("documented response + GET 404", () => {
  it("reports success with everything green", async () => {
    const { handler, deleteCount } = harness([() => [`@/dataSets/${ID}`]], [GONE]);
    const out = await parse(run(handler));
    expect(out.deleted).toBe(true);
    expect(out.deleteResponseMatchedDocumentation).toBe(true);
    expect(out.cleanupConfirmed).toBe(true);
    expect(out.postDeleteGetStatus).toBe(404);
    expect(out.responseContractMismatch).toBeNull();
    expect(out.retryPerformed).toBe(false);
    expect(deleteCount()).toBe(1);
  });
});

describe("the GET overrides an unexpected response body", () => {
  it.each([
    ["empty array", () => []],
    ["wrong id", () => ["@/dataSets/someone-else"]],
    ["a bare object", () => ({ ok: true })],
    ["null", () => null],
  ])("still confirms cleanup when the body is %s but GET says 404", async (_l, body) => {
    const { handler, deleteCount } = harness([body], [GONE]);
    const out = await parse(run(handler));
    expect(out.deleted).toBe(true);
    expect(out.cleanupConfirmed).toBe(true);
    expect(out.deleteResponseMatchedDocumentation).toBe(false);
    expect(out.responseContractMismatch).toBeTruthy();
    // The critical rule: an unexpected body must NOT trigger a retry.
    expect(out.retryPerformed).toBe(false);
    expect(deleteCount()).toBe(1);
  });
});

describe("DELETE 404 — target reported absent", () => {
  it("is confirmed only by the follow-up GET, not by the 404 alone", async () => {
    const { handler } = harness([GONE], [GONE]);
    const out = await parse(run(handler));
    expect(out.deleteOutcome).toBe("target-absent");
    expect(out.cleanupConfirmed).toBe(true);
  });

  it("does NOT claim success if the dataset somehow still exists", async () => {
    const { handler } = harness([GONE], [STILL_THERE, STILL_THERE, STILL_THERE]);
    const out = await parse(run(handler));
    expect(out.code).toBe("DELETE_NOT_CONFIRMED");
    expect(out.cleanupConfirmed).toBe(false);
  });
});

describe("authorization failures are never retried", () => {
  it.each([401, 403])("stops on %d", async (status) => {
    const { handler, deleteCount } = harness(
      [() => { throw new HttpError(status); }],
      [STILL_THERE, STILL_THERE, STILL_THERE],
    );
    const out = await parse(run(handler));
    expect(out.code).toBe("DELETE_AUTH_FAILURE");
    expect(out.retryPerformed).toBe(false);
    expect(deleteCount()).toBe(1);
  });
});

describe("ambiguous outcomes retry exactly once, and only if still present", () => {
  it.each([429, 500, 503])("retries after %d when the dataset is still there", async (status) => {
    const { handler, deleteCount } = harness(
      [() => { throw new HttpError(status); }, () => [`@/dataSets/${ID}`]],
      [STILL_THERE, STILL_THERE, STILL_THERE, GONE],
    );
    const out = await parse(run(handler));
    expect(out.retryPerformed).toBe(true);
    expect(deleteCount()).toBe(2);
    expect(out.cleanupConfirmed).toBe(true);
  });

  it("does NOT retry a 5xx when the GET already reports 404", async () => {
    // The delete evidently landed despite the error response.
    const { handler, deleteCount } = harness([() => { throw new HttpError(500); }], [GONE]);
    const out = await parse(run(handler));
    expect(out.cleanupConfirmed).toBe(true);
    expect(out.retryPerformed).toBe(false);
    expect(deleteCount()).toBe(1);
  });

  it("retries at most once, then reports an orphan", async () => {
    const { handler, deleteCount } = harness(
      [() => { throw new HttpError(503); }, () => { throw new HttpError(503); }],
      [STILL_THERE, STILL_THERE, STILL_THERE, STILL_THERE, STILL_THERE, STILL_THERE],
    );
    const out = await parse(run(handler));
    expect(out.code).toBe("DELETE_NOT_CONFIRMED");
    expect(out.message).toMatch(/ORPHAN/);
    expect(deleteCount()).toBe(2);
  });
});

describe("verification that cannot conclude is reported as unknown", () => {
  it.each([401, 403, 500])("returns CLEANUP_UNKNOWN when the GET fails with %d", async (status) => {
    const { handler } = harness(
      [() => [`@/dataSets/${ID}`]],
      [() => { throw new HttpError(status); }],
    );
    const out = await parse(run(handler));
    expect(out.code).toBe("CLEANUP_UNKNOWN");
    expect(out.cleanupConfirmed).toBe(false);
    expect(out.postDeleteGetStatus).toBe(status);
  });
});

describe("verifyGone tolerates propagation delay", () => {
  const ctx = (seq: Array<() => unknown>) => {
    let i = 0;
    return { client: { get: async () => { const s = seq[Math.min(i, seq.length - 1)]; i++; return s(); } } } as never;
  };

  it("succeeds on the third attempt if the delete propagates late", async () => {
    const v = await verifyGone(ctx([STILL_THERE, STILL_THERE, GONE]), ID, async () => {});
    expect(v.gone).toBe(true);
    expect(v.attempts).toBe(3);
  });

  it("gives up after three attempts", async () => {
    const v = await verifyGone(ctx([STILL_THERE]), ID, async () => {});
    expect(v.gone).toBe(false);
    expect(v.attempts).toBe(3);
  });

  it("stops immediately on an inconclusive status rather than retrying", async () => {
    const v = await verifyGone(ctx([() => { throw new HttpError(403); }]), ID, async () => {});
    expect(v.gone).toBe(false);
    expect(v.status).toBe(403);
    expect(v.attempts).toBe(1);
  });
});
