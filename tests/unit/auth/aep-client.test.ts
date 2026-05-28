import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AepClient } from "../../../src/auth/aep-client.js";
import { TokenCache } from "../../../src/auth/token-cache.js";
import { AepApiError } from "../../../src/util/errors.js";
import type { AepCredentials } from "../../../src/auth/credentials.js";

const mockCredentials: AepCredentials = {
  clientId: "test-client-id",
  clientSecret: "test-secret",
  orgId: "test-org@AdobeOrg",
  sandboxName: "dev",
};

describe("AepClient", () => {
  let client: AepClient;
  let tokenCache: TokenCache;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tokenCache = new TokenCache(mockCredentials);
    vi.spyOn(tokenCache, "getToken").mockResolvedValue("mock-token-123");
    client = new AepClient(mockCredentials, tokenCache);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct auth headers including sandbox name", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });

    await client.get("/data/foundation/schemaregistry/tenant/schemas");

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://platform.adobe.io/data/foundation/schemaregistry/tenant/schemas");
    expect(options.headers.Authorization).toBe("Bearer mock-token-123");
    expect(options.headers["x-api-key"]).toBe("test-client-id");
    expect(options.headers["x-gw-ims-org-id"]).toBe("test-org@AdobeOrg");
    expect(options.headers["x-sandbox-name"]).toBe("dev");
  });

  it("sends JSON body on POST", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "new-123" }),
    });

    const body = { name: "Test Segment", expression: { type: "PQL" } };
    await client.post("/data/core/ups/segment/definitions", body);

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.body).toBe(JSON.stringify(body));
  });

  it("appends query parameters", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });

    await client.get("/data/core/ups/segment/definitions", {
      limit: 10,
      start: 0,
      state: "ACTIVE",
    });

    const [url] = fetchSpy.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("start")).toBe("0");
    expect(parsed.searchParams.get("state")).toBe("ACTIVE");
  });

  it("skips undefined query parameters", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    });

    await client.get("/test", { limit: 10, status: undefined });

    const [url] = fetchSpy.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.has("status")).toBe(false);
  });

  it("throws AepApiError on non-2xx response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: "Forbidden" }),
    });

    await expect(client.get("/forbidden")).rejects.toThrow(AepApiError);

    const err = await client.get("/forbidden").catch((e) => e);
    expect(err).toBeInstanceOf(AepApiError);
    expect((err as AepApiError).status).toBe(403);
    expect((err as AepApiError).body).toEqual({ error: "Forbidden" });
  });

  it("handles non-JSON error responses (plain text bodies)", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const err = await client.get("/broken").catch((e) => e);
    expect(err).toBeInstanceOf(AepApiError);
    expect((err as AepApiError).body).toBe("Internal Server Error");
  });

  it("handles empty error responses", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "",
    });

    const err = await client.get("/empty-error").catch((e) => e);
    expect(err).toBeInstanceOf(AepApiError);
    expect((err as AepApiError).body).toBeNull();
  });

  it("handles 204 No Content", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const result = await client.delete("/data/core/ups/access/entities");
    expect(result).toBeUndefined();
  });

  it("supports custom headers (XDM schema content-type)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ $id: "schema-123" }),
    });

    await client.request({
      path: "/data/foundation/schemaregistry/tenant/schemas/123",
      headers: { Accept: "application/vnd.adobe.xed+json; version=1" },
    });

    const [, options] = fetchSpy.mock.calls[0];
    expect(options.headers.Accept).toBe("application/vnd.adobe.xed+json; version=1");
  });

  it("supports PUT and PATCH methods", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ updated: true }),
    });

    await client.put("/test/123", { name: "updated" });
    await client.patch("/test/456", { status: "active" });

    expect(fetchSpy.mock.calls[0][1].method).toBe("PUT");
    expect(fetchSpy.mock.calls[1][1].method).toBe("PATCH");
  });
});
