import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenCache } from "../../../src/auth/token-cache.js";
import type { AepCredentials } from "../../../src/auth/credentials.js";

const mockCredentials: AepCredentials = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  orgId: "test-org@AdobeOrg",
  sandboxName: "dev",
};

describe("TokenCache", () => {
  let cache: TokenCache;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cache = new TokenCache(mockCredentials);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a new token on first call", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "token-123",
        token_type: "bearer",
        expires_in: 86400,
      }),
    });

    const token = await cache.getToken();
    expect(token).toBe("token-123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://ims-na1.adobelogin.com/ims/token/v3");
    expect(options.method).toBe("POST");
  });

  it("returns cached token on subsequent calls", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "token-123",
        token_type: "bearer",
        expires_in: 86400,
      }),
    });

    await cache.getToken();
    const token2 = await cache.getToken();
    expect(token2).toBe("token-123");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent refresh requests", async () => {
    let resolveToken: (value: unknown) => void;
    const tokenPromise = new Promise((resolve) => {
      resolveToken = resolve;
    });

    fetchSpy.mockReturnValueOnce(
      tokenPromise.then(() => ({
        ok: true,
        json: async () => ({
          access_token: "token-dedup",
          token_type: "bearer",
          expires_in: 86400,
        }),
      })),
    );

    const p1 = cache.getToken();
    const p2 = cache.getToken();
    const p3 = cache.getToken();

    resolveToken!(undefined);

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
    expect(t1).toBe("token-dedup");
    expect(t2).toBe("token-dedup");
    expect(t3).toBe("token-dedup");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws AuthError on failed token refresh without leaking IMS body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized: invalid client_secret xyz123",
    });

    // The IMS response body can contain client_id / client_secret hints; ensure
    // it is NOT included in the thrown error message.
    const err = await cache.getToken().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe("AuthError");
    expect((err as Error).message).toBe("IMS token refresh failed");
    expect((err as Error).message).not.toContain("Unauthorized");
    expect((err as Error).message).not.toContain("client_secret");
    expect((err as { status: number }).status).toBe(401);
  });

  it("clears token on invalidate", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "token-fresh",
        token_type: "bearer",
        expires_in: 86400,
      }),
    });

    await cache.getToken();
    cache.invalidate();
    await cache.getToken();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
