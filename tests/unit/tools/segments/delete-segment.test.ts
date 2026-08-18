import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/segments/delete-segment.js";
import { AepApiError } from "../../../../src/util/errors.js";

/**
 * Segments could be created but never deleted until 0.9.1, so every segment an
 * agent made was permanent. That asymmetry is the reason this tool exists.
 *
 * The property that matters most: a DELETE returning 200 is NOT evidence the
 * segment is gone. Adobe answers with an empty body, which is the write
 * reporting on itself. Only a follow-up GET settles it.
 */

const SEG = "87be52f7-a46d-45b8-a0c5-271a8c22638c";
const OK = { id: SEG, name: "fixture", description: "d" };

/** getSeq: what the GET returns on each successive call. */
function harness(getSeq: Array<"ok" | "404" | "500">) {
  const calls: Array<{ method: string; path: string }> = [];
  let i = 0;
  const request = vi.fn(async (spec: any) => {
    calls.push({ method: spec.method, path: spec.path });
    if (spec.method === "DELETE") return {};
    const mode = getSeq[Math.min(i++, getSeq.length - 1)];
    if (mode === "404") throw new AepApiError(404, { title: "Not found" });
    if (mode === "500") throw new AepApiError(500, { title: "Server error" });
    return OK;
  });
  const handlers = new Map<string, any>();
  register(
    { registerTool: (n: string, _c: unknown, h: any) => handlers.set(n, h), tool: () => {} } as never,
    { client: { request }, tokenCache: {},
      credentials: { clientId: "c", clientSecret: "s", orgId: "O@AdobeOrg", sandboxName: "dev-sandbox" } } as never,
  );
  return { calls, handler: handlers.get("aep_delete_segment")!,
    deletes: () => calls.filter((c) => c.method === "DELETE") };
}
const parse = async (p: Promise<any>) => { const r = await p; return { isError: r.isError, body: JSON.parse(r.content[0].text) }; };

describe("dryRun defaults true", () => {
  it("does not DELETE by default", async () => {
    const h = harness(["ok"]);
    const { body } = await parse(h.handler({ segmentId: SEG, dryRun: true }, {}));
    expect(body.sent).toBe(false);
    expect(body.wouldDelete.segmentId).toBe(SEG);
    expect(h.deletes()).toHaveLength(0);
  });

  it("warns that activations stop resolving", async () => {
    const h = harness(["ok"]);
    const { body } = await parse(h.handler({ segmentId: SEG, dryRun: true }, {}));
    expect(body._warning).toMatch(/PERMANENTLY/);
    expect(body._warning).toMatch(/activation/i);
  });
});

describe("the confirmation is bound to the segment id", () => {
  it("refuses a missing confirmation, without deleting", async () => {
    const h = harness(["ok"]);
    const { body } = await parse(h.handler({ segmentId: SEG, dryRun: false }, {}));
    expect(body.code).toBe("CONFIRMATION_REQUIRED");
    expect(h.deletes()).toHaveLength(0);
  });

  it("refuses a confirmation naming a DIFFERENT segment", async () => {
    const h = harness(["ok"]);
    const { body } = await parse(h.handler(
      { segmentId: SEG, dryRun: false, confirm: "DELETE SEGMENT some-other-id" }, {}));
    expect(body.code).toBe("CONFIRMATION_REQUIRED");
    expect(h.deletes()).toHaveLength(0);
  });

  it("deletes on an exact match", async () => {
    const h = harness(["ok", "404"]);
    const { isError, body } = await parse(h.handler(
      { segmentId: SEG, dryRun: false, confirm: `DELETE SEGMENT ${SEG}` }, {}));
    expect(isError).toBeFalsy();
    expect(body.verifiedGone).toBe(true);
    expect(h.deletes()).toHaveLength(1);
  });
});

describe("a 200 from DELETE is not proof — the GET is", () => {
  it("reports DELETE_NOT_CONFIRMED when the segment is still readable", async () => {
    // DELETE succeeds, but the follow-up GET still returns the segment.
    const h = harness(["ok", "ok"]);
    const { isError, body } = await parse(h.handler(
      { segmentId: SEG, dryRun: false, confirm: `DELETE SEGMENT ${SEG}` }, {}));
    expect(isError).toBe(true);
    expect(body.code).toBe("DELETE_NOT_CONFIRMED");
  });

  it("does not swallow a 500 on the verification GET as success", async () => {
    const h = harness(["ok", "500"]);
    const { isError, body } = await parse(h.handler(
      { segmentId: SEG, dryRun: false, confirm: `DELETE SEGMENT ${SEG}` }, {}));
    expect(isError).toBe(true);
    expect(body.code).not.toBe("DELETE_NOT_CONFIRMED"); // it propagates, not misreports
  });
});

describe("target validation", () => {
  it.each(["ALL", "all", "*", "any", "a,b", "   ", "../x"])("refuses %j before any call", async (bad) => {
    const h = harness(["ok"]);
    const { body } = await parse(h.handler({ segmentId: bad, dryRun: false, confirm: "x" }, {}));
    expect(body.code).toBe("INVALID_SEGMENT_ID");
    expect(h.calls).toHaveLength(0);
  });

  it("reports a missing segment as NOT_FOUND rather than a bare 404", async () => {
    const h = harness(["404"]);
    const { body } = await parse(h.handler({ segmentId: SEG, dryRun: true }, {}));
    expect(body.code).toBe("SEGMENT_NOT_FOUND");
    expect(h.deletes()).toHaveLength(0);
  });
});
