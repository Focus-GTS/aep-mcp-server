import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/hygiene/create-dataset-expiration.js";

/**
 * dryRun must not touch the network.
 *
 * Until 2026-08-14 this tool advertised dryRun as a safe preview, then issued
 * a real mutating request with `?dryRun=true` appended. Adobe documents no
 * dry-run mode for dataset expiration, and servers routinely ignore query
 * parameters they do not recognise — so a "dry run" would have scheduled the
 * permanent deletion of a real dataset. In a shared sandbox, someone else's.
 *
 * The single most important assertion in this file is that the client is
 * never called at all.
 */

const VALID_ARGS = {
  datasetId: "ds-123",
  expiry: "2030-01-01T00:00:00Z",
  dryRun: true,
  confirm: undefined as string | undefined,
};

function harness() {
  const request = vi.fn(async () => ({ id: "exp-1" }));
  const handlers = new Map<string, (a: unknown, e: unknown) => Promise<any>>();
  const server = {
    registerTool: (n: string, _m: unknown, h: any) => handlers.set(n, h),
    tool: (n: string, _d: unknown, _s: unknown, h: any) => handlers.set(n, h),
  };
  register(server as never, {
    client: { request, post: request, put: request, delete: request },
    tokenCache: {},
    credentials: {
      clientId: "c", clientSecret: "s",
      orgId: "ORG123456789012345678@AdobeOrg", sandboxName: "focusgts-ucp",
    },
  } as never);
  return { request, handler: handlers.get("aep_create_dataset_expiration")! };
}

const parse = (r: any) => JSON.parse(r.content[0].text);

describe("dryRun sends nothing", () => {
  it("makes ZERO network calls", async () => {
    const { request, handler } = harness();
    await handler(VALID_ARGS, {});
    expect(request).not.toHaveBeenCalled();
  });

  it("reports sent:false", async () => {
    const { handler } = harness();
    expect(parse(await handler(VALID_ARGS, {})).sent).toBe(false);
  });

  it("returns the request it WOULD send, for inspection", async () => {
    const { handler } = harness();
    const out = parse(await handler(VALID_ARGS, {}));
    expect(out.wouldSend).toMatchObject({
      method: "POST",
      path: "/data/core/hygiene/ttl",
    });
    expect(out.wouldSend.body).toMatchObject({
      datasetId: "ds-123",
      expiry: "2030-01-01T00:00:00Z",
    });
  });

  it("warns that Adobe does not support dry run, so shape != acceptance", async () => {
    const { handler } = harness();
    const out = parse(await handler(VALID_ARGS, {}));
    expect(out._warning).toMatch(/does not document a dry-run/i);
    expect(out._warning).toMatch(/LOCALLY/);
  });
});

describe("the real request matches Adobe's documented shape", () => {
  it("POSTs to /data/core/hygiene/ttl with datasetId in the BODY", async () => {
    // Was: PUT /data/core/hygiene/ttl/{datasetId}?dryRun=true — wrong method,
    // wrong path shape, and an undocumented query parameter.
    const { request, handler } = harness();
    await handler(
      { ...VALID_ARGS, dryRun: false, confirm: "I understand this is irreversible" },
      {},
    );
    expect(request).toHaveBeenCalledTimes(1);
    const spec = request.mock.calls[0][0] as any;
    expect(spec.method).toBe("POST");
    expect(spec.path).toBe("/data/core/hygiene/ttl");
    expect(spec.body.datasetId).toBe("ds-123");
  });

  it("never sends a dryRun parameter to Adobe", async () => {
    const { request, handler } = harness();
    await handler(
      { ...VALID_ARGS, dryRun: false, confirm: "I understand this is irreversible" },
      {},
    );
    const spec = request.mock.calls[0][0] as any;
    expect(JSON.stringify(spec)).not.toMatch(/dryRun/);
    expect(spec.query).toBeUndefined();
  });

  it("does not put the datasetId in the path", async () => {
    const { request, handler } = harness();
    await handler(
      { ...VALID_ARGS, dryRun: false, confirm: "I understand this is irreversible" },
      {},
    );
    expect((request.mock.calls[0][0] as any).path).not.toContain("ds-123");
  });
});

describe("the confirmation gate still stands for real writes", () => {
  it("refuses without the exact phrase, before any network call", async () => {
    const { request, handler } = harness();
    const out = parse(await handler({ ...VALID_ARGS, dryRun: false, confirm: "yes" }, {}));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses when confirm is omitted entirely", async () => {
    const { request, handler } = harness();
    const out = parse(await handler({ ...VALID_ARGS, dryRun: false, confirm: undefined }, {}));
    expect(out.code).toBe("CONFIRMATION_REQUIRED");
    expect(request).not.toHaveBeenCalled();
  });
});
