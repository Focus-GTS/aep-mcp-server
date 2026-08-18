import { describe, it, expect, vi } from "vitest";
import { register as registerList } from "../../../../src/tools/ajo/list-campaigns.js";
import { register as registerGet } from "../../../../src/tools/ajo/get-campaign.js";
import { AJO_CAMPAIGNS_PATH, ajoCampaignPath } from "../../../../src/tools/ajo/paths.js";
import { AepApiError } from "../../../../src/util/errors.js";

/**
 * AJO paths in this module were established by live probe, not documentation —
 * the datastream tools were built the other way round and never worked once.
 * These tests pin the probed shape so a future edit cannot quietly drift back
 * onto a route that does not exist.
 */

function harness(reg: typeof registerList, name: string, impl: () => Promise<unknown>) {
  const spec: Array<{ method: string; path: string; query?: Record<string, unknown> }> = [];
  const request = vi.fn(async (s: any) => { spec.push(s); return impl(); });
  const handlers = new Map<string, any>();
  reg(
    { registerTool: (n: string, _c: unknown, h: any) => handlers.set(n, h), tool: () => {} } as never,
    { client: { request }, tokenCache: {},
      credentials: { clientId: "c", clientSecret: "s", orgId: "O@AdobeOrg", sandboxName: "dev-sandbox" } } as never,
  );
  return { spec, handler: handlers.get(name)! };
}
const parse = async (p: Promise<any>) => { const r = await p; return { isError: r.isError, body: JSON.parse(r.content[0].text) }; };

const LIVE_EMPTY = {
  data: [],
  _page: { orderby: "name", count: 50, page: 1, type: "list", totalPages: 0, totalCount: 0 },
  _links: {},
};

describe("ajo_list_campaigns", () => {
  it("calls the probed path", async () => {
    const h = harness(registerList, "ajo_list_campaigns", async () => LIVE_EMPTY);
    await h.handler({ count: 50, page: 1, full: false }, {});
    expect(h.spec[0].path).toBe(AJO_CAMPAIGNS_PATH);
    expect(h.spec[0].path).toBe("/ajo/campaigns");
  });

  it("uses Adobe's page/count paging, not limit/offset", async () => {
    // The rest of this server speaks limit/offset. AJO does not, and sending
    // limit here silently returns Adobe's default page instead of the asked-for
    // one — a wrong answer that looks like a right one.
    const h = harness(registerList, "ajo_list_campaigns", async () => LIVE_EMPTY);
    await h.handler({ count: 5, page: 3, full: false }, {});
    expect(h.spec[0].query).toMatchObject({ count: 5, page: 3 });
    expect(h.spec[0].query).not.toHaveProperty("limit");
    expect(h.spec[0].query).not.toHaveProperty("offset");
  });

  it("omits orderby and full unless asked", async () => {
    const h = harness(registerList, "ajo_list_campaigns", async () => LIVE_EMPTY);
    await h.handler({ count: 50, page: 1, full: false }, {});
    expect(h.spec[0].query).not.toHaveProperty("orderby");
    expect(h.spec[0].query).not.toHaveProperty("full");
  });

  it("passes orderBy through as Adobe's `orderby`", async () => {
    const h = harness(registerList, "ajo_list_campaigns", async () => LIVE_EMPTY);
    await h.handler({ count: 50, page: 1, orderBy: "-modifiedAt", full: false }, {});
    expect(h.spec[0].query).toMatchObject({ orderby: "-modifiedAt" });
  });

  it("reports an empty tenant as an empty list, not an error", async () => {
    // This is the real live response from a sandbox with no campaigns.
    const h = harness(registerList, "ajo_list_campaigns", async () => LIVE_EMPTY);
    const { isError, body } = await parse(h.handler({ count: 50, page: 1, full: false }, {}));
    expect(isError).toBeFalsy();
    expect(body.campaigns).toEqual([]);
    expect(body.totalCount).toBe(0);
    expect(body.hasMore).toBe(false);
  });

  it("computes hasMore from Adobe's page metadata", async () => {
    const h = harness(registerList, "ajo_list_campaigns", async () => ({
      data: [{ id: "a" }],
      _page: { page: 1, count: 1, totalPages: 4, totalCount: 4 },
    }));
    const { body } = await parse(h.handler({ count: 1, page: 1, full: false }, {}));
    expect(body.hasMore).toBe(true);
    expect(body.totalPages).toBe(4);
  });

  it("survives a response with no _page envelope", async () => {
    const h = harness(registerList, "ajo_list_campaigns", async () => ({ data: [{ id: "a" }] }));
    const { isError, body } = await parse(h.handler({ count: 50, page: 1, full: false }, {}));
    expect(isError).toBeFalsy();
    expect(body.count).toBe(1);
    expect(body.totalCount).toBeNull();
  });
});

describe("ajo_get_campaign", () => {
  it("builds the single-campaign path and encodes the id", async () => {
    const h = harness(registerGet, "ajo_get_campaign", async () => ({ id: "abc", name: "n" }));
    await h.handler({ campaignId: "a b/c" }, {});
    expect(h.spec[0].path).toBe(ajoCampaignPath("a b/c"));
    expect(h.spec[0].path).toContain("a%20b%2Fc");
  });

  it("distinguishes 'no published version' from 'unknown id'", async () => {
    // Adobe returns CJMCMP-2044-404 when the campaign row exists but has never
    // been published. Flattening that into a generic 404 sends someone hunting
    // for a campaign that is in fact right there, as a draft.
    const h = harness(registerGet, "ajo_get_campaign", async () => {
      throw new AepApiError(404, {
        type: "https://ns.adobe.com/aep/errors/CJMCMP-2044-404",
        title: "No acceptable version",
        message: "The campaign has no acceptable version",
      });
    });
    const { isError, body } = await parse(h.handler({ campaignId: "x" }, {}));
    expect(isError).toBe(true);
    expect(body.code).toBe("CAMPAIGN_HAS_NO_VERSION");
    expect(body.message).toMatch(/draft/);
  });

  it("still reports an ordinary 404 as an ordinary error", async () => {
    const h = harness(registerGet, "ajo_get_campaign", async () => {
      throw new AepApiError(404, { title: "Not found" });
    });
    const { isError, body } = await parse(h.handler({ campaignId: "x" }, {}));
    expect(isError).toBe(true);
    expect(body.code).not.toBe("CAMPAIGN_HAS_NO_VERSION");
  });

  it("rejects a blank id before any network call", async () => {
    const h = harness(registerGet, "ajo_get_campaign", async () => ({}));
    const { body } = await parse(h.handler({ campaignId: "   " }, {}));
    expect(body.code).toBe("INVALID_CAMPAIGN_ID");
    expect(h.spec).toHaveLength(0);
  });
});

describe("the AJO surface stays as narrow as the probe found it", () => {
  it("wraps campaigns only", async () => {
    // Journeys, messages, channel surfaces, content templates, fragments,
    // offers and decisions all returned an HTML 404 on 2026-08-18 — the gateway
    // has no such route. Implementing them would repeat the datastream mistake.
    const names: string[] = [];
    const capture = { registerTool: (n: string) => names.push(n), tool: (n: string) => names.push(n) } as never;
    const ctx = { client: { request: vi.fn() }, tokenCache: {}, credentials: {} } as never;
    registerList(capture, ctx);
    registerGet(capture, ctx);
    expect(names.sort()).toEqual(["ajo_get_campaign", "ajo_list_campaigns"]);
  });
});
