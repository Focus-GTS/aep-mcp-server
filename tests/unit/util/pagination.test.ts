import { describe, it, expect } from "vitest";
import {
  buildPaginatedResponse,
  extractPageHints,
} from "../../../src/util/pagination.js";

describe("buildPaginatedResponse", () => {
  describe("with a genuine total (client-side pagination)", () => {
    it("reports hasMore=true mid-way through the set", () => {
      const items = [{ id: "1" }, { id: "2" }];
      const result = buildPaginatedResponse(
        items,
        { limit: 2, offset: 0 },
        { total: 10 },
      );

      expect(result).toEqual({
        results: items,
        count: 2,
        total: 10,
        offset: 0,
        limit: 2,
        hasMore: true,
        hasMoreBasis: "total",
      });
    });

    it("reports hasMore=false on the last page", () => {
      const items = [{ id: "9" }, { id: "10" }];
      const result = buildPaginatedResponse(
        items,
        { limit: 2, offset: 8 },
        { total: 10 },
      );

      expect(result.hasMore).toBe(false);
      expect(result.hasMoreBasis).toBe("total");
    });

    it("reports hasMore=false for a single short page", () => {
      const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
      const result = buildPaginatedResponse(
        items,
        { limit: 20, offset: 0 },
        { total: 3 },
      );

      expect(result.count).toBe(3);
      expect(result.hasMore).toBe(false);
    });
  });

  describe("REGRESSION: hasMore must not be permanently false", () => {
    // The shipped bug: callers derived `total` as `results.length + offset`,
    // making `offset + count < total` algebraically impossible. The old suite
    // never asserted hasMore===true without an externally supplied total, so
    // nothing caught it. These tests exist specifically to keep it dead.

    it("infers hasMore=true from a full page when no total is known", () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
      const result = buildPaginatedResponse(items, { limit: 20, offset: 0 });

      expect(result.hasMore).toBe(true);
      expect(result.hasMoreBasis).toBe("full-page");
      expect(result.total).toBeNull();
    });

    it("infers hasMore=true from a full page on a later offset", () => {
      const items = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
      const result = buildPaginatedResponse(items, { limit: 20, offset: 40 });

      expect(result.hasMore).toBe(true);
      expect(result.offset).toBe(40);
    });

    it("infers hasMore=false from a short page when no total is known", () => {
      const items = [{ id: "1" }, { id: "2" }];
      const result = buildPaginatedResponse(items, { limit: 20, offset: 0 });

      expect(result.hasMore).toBe(false);
      expect(result.hasMoreBasis).toBe("short-page");
    });

    it("trusts an explicit next link over every other signal", () => {
      // A short page that nonetheless advertises a next link: the link wins.
      const items = [{ id: "1" }];
      const result = buildPaginatedResponse(
        items,
        { limit: 20, offset: 0 },
        { nextLink: "https://platform.adobe.io/next?start=1" },
      );

      expect(result.hasMore).toBe(true);
      expect(result.hasMoreBasis).toBe("next-link");
      expect(result.nextLink).toBe("https://platform.adobe.io/next?start=1");
    });
  });

  describe("unknown vs zero", () => {
    it("reports total=null when the API gave no total", () => {
      const result = buildPaginatedResponse([], { limit: 20, offset: 0 });

      expect(result.count).toBe(0);
      // null, NOT 0 — "we don't know" must be distinguishable from "empty".
      expect(result.total).toBeNull();
      expect(result.hasMore).toBe(false);
    });

    it("reports total=0 when the API genuinely said zero", () => {
      const result = buildPaginatedResponse(
        [],
        { limit: 20, offset: 0 },
        { total: 0 },
      );

      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });
  });
});

describe("extractPageHints", () => {
  it("reads a total from _page.totalCount", () => {
    expect(extractPageHints({ _page: { totalCount: 250 } })).toEqual({
      total: 250,
    });
  });

  it("reads a total from _page.total", () => {
    expect(extractPageHints({ _page: { total: 99 } })).toEqual({ total: 99 });
  });

  it("reads a top-level totalCount", () => {
    expect(extractPageHints({ totalCount: 42 })).toEqual({ total: 42 });
  });

  it("IGNORES a bare top-level `count`", () => {
    // Schema Registry returns `count` meaning "records on THIS page". Treating
    // it as a cross-page total is the precise cause of the original bug.
    expect(extractPageHints({ count: 20 })).toEqual({});
  });

  it("extracts a next link from _links.next.href", () => {
    expect(
      extractPageHints({ _links: { next: { href: "/schemas?start=20" } } }),
    ).toEqual({ nextLink: "/schemas?start=20" });
  });

  it("extracts a next link given as a bare string", () => {
    expect(extractPageHints({ _links: { next: "/schemas?start=20" } })).toEqual(
      { nextLink: "/schemas?start=20" },
    );
  });

  it("extracts both total and next link together", () => {
    expect(
      extractPageHints({
        _page: { totalCount: 100 },
        _links: { next: { href: "/next" } },
      }),
    ).toEqual({ total: 100, nextLink: "/next" });
  });

  it("returns empty hints for unusable input", () => {
    expect(extractPageHints(null)).toEqual({});
    expect(extractPageHints(undefined)).toEqual({});
    expect(extractPageHints("nope")).toEqual({});
    expect(extractPageHints({})).toEqual({});
  });
});
