import { describe, it, expect, vi } from "vitest";
import { register } from "../../../../src/tools/privacy/list-privacy-jobs.js";
import { AepApiError } from "../../../../src/util/errors.js";

/**
 * Adobe Privacy Service answers an empty job list with HTTP 404:
 *
 *   {"errors":{"errorCode":404,"title":"Resource not found",
 *              "detail":"Not able to find job data."}}
 *
 * Confirmed live on 2026-08-17 against a tenant with zero jobs — which is the
 * normal state of most tenants. Surfacing it as AEP_404 made "you have no
 * privacy jobs" look like a broken tool and pushed agents into retrying.
 *
 * The distinction is narrow on purpose: a 404 that reads as "not authorized"
 * or "not provisioned" is still an error, because it needs a human.
 */

const EMPTY_404 = {
  errors: { errorCode: 404, title: "Resource not found", detail: "Not able to find job data." },
};
const FORBIDDEN_404 = {
  errors: { errorCode: 404, title: "Forbidden", detail: "Not authorized for this resource." },
};

function harness(err?: unknown) {
  const request = vi.fn(async () => {
    if (err) throw err;
    return { results: [] };
  });
  const handlers = new Map<string, (a: unknown, e: unknown) => Promise<any>>();
  register(
    { registerTool: (n: string, _c: unknown, h: any) => handlers.set(n, h), tool: () => {} } as never,
    { client: { request }, tokenCache: {},
      credentials: { clientId: "c", clientSecret: "s", orgId: "O@AdobeOrg", sandboxName: "dev-sandbox" } } as never,
  );
  return { request, handler: handlers.get("aep_list_privacy_jobs")! };
}
const parse = async (p: Promise<any>) => {
  const r = await p;
  return { isError: r.isError, body: JSON.parse(r.content[0].text) };
};

describe("an empty privacy job list is a result, not an error", () => {
  it("returns an empty list when Adobe 404s with 'Not able to find job data'", async () => {
    const h = harness(new AepApiError(404, EMPTY_404));
    const { isError, body } = await parse(h.handler({ regulation: "gdpr", limit: 10, offset: 0 }, {}));
    expect(isError).toBeFalsy();
    expect(body.results).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("still errors on a 404 that means 'not authorized'", async () => {
    const h = harness(new AepApiError(404, FORBIDDEN_404));
    const { isError, body } = await parse(h.handler({ regulation: "gdpr", limit: 10, offset: 0 }, {}));
    expect(isError).toBe(true);
    expect(body.code).toMatch(/AEP_404/);
  });

  it("still errors on a 403", async () => {
    const h = harness(new AepApiError(403, { detail: "Forbidden" }));
    const { isError } = await parse(h.handler({ regulation: "gdpr", limit: 10, offset: 0 }, {}));
    expect(isError).toBe(true);
  });

  it("passes a populated list straight through", async () => {
    const h = harness();
    const { isError, body } = await parse(h.handler({ regulation: "gdpr", limit: 10, offset: 0 }, {}));
    expect(isError).toBeFalsy();
    expect(body.results).toEqual([]);
  });
});
