import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadCredentials } from "../../../src/auth/credentials.js";
import { MissingCredentialsError } from "../../../src/util/errors.js";

/**
 * AEP_SANDBOX_NAME must fail closed.
 *
 * It previously defaulted to "prod". A .env missing one line therefore pointed
 * every request at production, silently — reads included, with no warning that
 * the sandbox in use was not the one the operator believed they had set.
 */

const KEYS = [
  "AEP_CLIENT_ID",
  "AEP_CLIENT_SECRET",
  "AEP_ORG_ID",
  "AEP_SANDBOX_NAME",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.AEP_CLIENT_ID = "cid";
  process.env.AEP_CLIENT_SECRET = "secret";
  process.env.AEP_ORG_ID = "ORG123456789012345678@AdobeOrg";
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("AEP_SANDBOX_NAME is required", () => {
  it("throws when the variable is entirely absent", () => {
    expect(() => loadCredentials()).toThrow(MissingCredentialsError);
  });

  it("does NOT silently fall back to prod — the regression this prevents", () => {
    let sandboxName: string | undefined;
    try {
      sandboxName = loadCredentials().sandboxName;
    } catch {
      sandboxName = undefined;
    }
    expect(sandboxName).not.toBe("prod");
    expect(sandboxName).toBeUndefined();
  });

  it.each([
    ["empty string", ""],
    ["single space", " "],
    ["whitespace only", "   \t  "],
  ])("throws when the value is %s", (_label, value) => {
    process.env.AEP_SANDBOX_NAME = value;
    expect(() => loadCredentials()).toThrow(MissingCredentialsError);
  });

  it("names the offending variable in the error", () => {
    try {
      loadCredentials();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("AEP_SANDBOX_NAME");
    }
  });

  it("explains the removed prod default, so the fix is obvious", () => {
    try {
      loadCredentials();
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/no default/i);
      expect((e as Error).message).toMatch(/prod/);
    }
  });
});

describe("explicitly configured sandboxes still load", () => {
  it("accepts a development sandbox", () => {
    process.env.AEP_SANDBOX_NAME = "focusgts-ucp";
    expect(loadCredentials().sandboxName).toBe("focusgts-ucp");
  });

  it("accepts an explicit 'prod' — a deliberate, visible choice", () => {
    // Reads against production remain permitted. Mutations there are blocked
    // separately by the write guard's sandbox-name refusal, which is where
    // that protection belongs.
    process.env.AEP_SANDBOX_NAME = "prod";
    expect(loadCredentials().sandboxName).toBe("prod");
  });

  it("trims surrounding whitespace rather than sending it as a header", () => {
    process.env.AEP_SANDBOX_NAME = "  focusgts-ucp  ";
    expect(loadCredentials().sandboxName).toBe("focusgts-ucp");
  });

  it("trims the other credentials too", () => {
    process.env.AEP_CLIENT_ID = "  cid  ";
    process.env.AEP_SANDBOX_NAME = "dev1";
    expect(loadCredentials().clientId).toBe("cid");
  });
});

describe("the other required variables fail closed the same way", () => {
  it.each(["AEP_CLIENT_ID", "AEP_CLIENT_SECRET", "AEP_ORG_ID"])(
    "throws when %s is blank",
    (key) => {
      process.env.AEP_SANDBOX_NAME = "dev1";
      process.env[key] = "   ";
      expect(() => loadCredentials()).toThrow(MissingCredentialsError);
    },
  );
});
