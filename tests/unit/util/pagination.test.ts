import { describe, it, expect } from "vitest";
import { buildPaginatedResponse } from "../../../src/util/pagination.js";

describe("buildPaginatedResponse", () => {
  it("builds correct response with hasMore=true", () => {
    const items = [{ id: "1" }, { id: "2" }];
    const result = buildPaginatedResponse(items, 10, { limit: 2, offset: 0 });

    expect(result).toEqual({
      results: items,
      count: 2,
      total: 10,
      offset: 0,
      limit: 2,
      hasMore: true,
    });
  });

  it("sets hasMore=false when at end", () => {
    const items = [{ id: "9" }, { id: "10" }];
    const result = buildPaginatedResponse(items, 10, { limit: 2, offset: 8 });

    expect(result.hasMore).toBe(false);
  });

  it("handles empty results", () => {
    const result = buildPaginatedResponse([], 0, { limit: 20, offset: 0 });

    expect(result.count).toBe(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("handles single page", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const result = buildPaginatedResponse(items, 3, { limit: 20, offset: 0 });

    expect(result.count).toBe(3);
    expect(result.hasMore).toBe(false);
  });
});
