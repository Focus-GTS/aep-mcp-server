import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/schemas/list-schemas.js";

/**
 * Schema Registry pages by an OPAQUE CURSOR, not a numeric offset.
 *
 * Verified live 2026-08-14 against a sandbox holding 20 schemas:
 *   ?limit=10           -> 10 results
 *   ?limit=10&start=0   ->  0 results   <-- silently empty
 *
 * The tool sent `start: offset` unconditionally, and offset defaults to 0, so
 * aep_list_schemas returned an empty list on EVERY sandbox. A 200 with zero
 * results is indistinguishable from an empty registry, and it was written into
 * a validation report as "0 tenant schemas" before anyone cross-checked it.
 */

function harness() {
  const request = vi.fn(async () => ({ results: [{ $id: "a" }, { $id: "b" }] }));
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
  return { request, handler: handlers.get("aep_list_schemas")! };
}

const parse = (r: any) => JSON.parse(r.content[0].text);

describe("never sends start=0", () => {
  it("omits `start` entirely on a default call", async () => {
    const { request, handler } = harness();
    await handler({ limit: 20, offset: 0, containerType: "tenant" }, {});
    const q = (request.mock.calls[0][0] as any).query;
    expect(q).not.toHaveProperty("start");
    expect(q.limit).toBe(20);
  });

  it("returns the results Adobe sent, rather than an empty list", async () => {
    const { handler } = harness();
    const out = parse(await handler({ limit: 20, offset: 0, containerType: "tenant" }, {}));
    expect(out.count).toBe(2);
  });

  it("sends no query parameter whose value is the number 0", async () => {
    const { request, handler } = harness();
    await handler({ limit: 20, offset: 0, containerType: "tenant" }, {});
    const q = (request.mock.calls[0][0] as any).query ?? {};
    expect(Object.values(q)).not.toContain(0);
  });
});

describe("a numeric offset is refused, not silently ignored", () => {
  it("returns UNSUPPORTED_PAGINATION without calling Adobe", async () => {
    const { request, handler } = harness();
    const out = parse(await handler({ limit: 20, offset: 10, containerType: "tenant" }, {}));
    expect(out.code).toBe("UNSUPPORTED_PAGINATION");
    expect(request).not.toHaveBeenCalled();
  });

  it("explains what to do instead", async () => {
    const { handler } = harness();
    const out = parse(await handler({ limit: 20, offset: 10, containerType: "tenant" }, {}));
    expect(out.message).toMatch(/cursor/i);
    expect(out.message).toMatch(/limit/i);
  });
});
