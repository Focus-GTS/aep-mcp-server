import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadCredentials } from "../../../src/auth/credentials.js";
import { MissingCredentialsError } from "../../../src/util/errors.js";

describe("loadCredentials", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AEP_CLIENT_ID = "test-client";
    process.env.AEP_CLIENT_SECRET = "test-secret";
    process.env.AEP_ORG_ID = "test-org@AdobeOrg";
    process.env.AEP_SANDBOX_NAME = "dev";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads all credentials from env", () => {
    const creds = loadCredentials();
    expect(creds).toEqual({
      clientId: "test-client",
      clientSecret: "test-secret",
      orgId: "test-org@AdobeOrg",
      sandboxName: "dev",
    });
  });

  // Was: "defaults sandboxName to prod when not set".
  //
  // That test asserted the defect. A .env missing one line pointed every
  // request at production, and this test locked that in as intended behaviour.
  // Full coverage of the replacement lives in sandbox-name-required.test.ts.
  it("throws rather than defaulting to prod when AEP_SANDBOX_NAME is not set", () => {
    delete process.env.AEP_SANDBOX_NAME;
    expect(() => loadCredentials()).toThrow(MissingCredentialsError);
    expect(() => loadCredentials()).toThrow("AEP_SANDBOX_NAME");
  });

  it("throws MissingCredentialsError when CLIENT_ID is missing", () => {
    delete process.env.AEP_CLIENT_ID;
    expect(() => loadCredentials()).toThrow(MissingCredentialsError);
    expect(() => loadCredentials()).toThrow("AEP_CLIENT_ID");
  });

  it("throws MissingCredentialsError listing all missing vars", () => {
    delete process.env.AEP_CLIENT_ID;
    delete process.env.AEP_CLIENT_SECRET;
    delete process.env.AEP_ORG_ID;

    try {
      loadCredentials();
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MissingCredentialsError);
      const msg = (e as Error).message;
      expect(msg).toContain("AEP_CLIENT_ID");
      expect(msg).toContain("AEP_CLIENT_SECRET");
      expect(msg).toContain("AEP_ORG_ID");
    }
  });
});
