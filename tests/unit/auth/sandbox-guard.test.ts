import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveSandbox,
  assertWriteAllowed,
  productionWritesAllowed,
  resolveWriteMode,
  currentWriteMode,
  WriteBlockedError,
  ProductionWriteBlockedError,
  type SandboxInfo,
} from "../../../src/auth/sandbox-guard.js";
import type { AepCredentials } from "../../../src/auth/credentials.js";

/**
 * The mutation gates (AEP_ALLOW_MUTATIONS and the prod-name refusal) are
 * exercised in tests/unit/auth/mutation-gates.test.ts. This file tests the
 * write-MODE and sandbox-TYPE logic that sits behind them, so it opts past
 * both to isolate the gate under test.
 */
beforeEach(() => {
  process.env.AEP_ALLOW_MUTATIONS = "true";
  process.env.AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD = "true";
});
afterEach(() => {
  delete process.env.AEP_ALLOW_MUTATIONS;
  delete process.env.AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD;
});


const creds: AepCredentials = {
  clientId: "cid",
  clientSecret: "sec",
  orgId: "ORG123456789012345678@AdobeOrg",
  sandboxName: "prod",
};

const devCreds: AepCredentials = { ...creds, sandboxName: "focusgts-ucp" };

function client(payload: unknown, shouldThrow?: { status?: number }) {
  return {
    request: vi.fn(async () => {
      if (shouldThrow) {
        const e = new Error("nope") as Error & { status?: number };
        e.status = shouldThrow.status;
        throw e;
      }
      return payload as never;
    }),
  };
}

const DEV: SandboxInfo = { name: "dev1", type: "development", source: "adobe-api" };
const PROD: SandboxInfo = { name: "prod", type: "production", source: "adobe-api" };
const UNKNOWN: SandboxInfo = {
  name: "x",
  type: "unknown",
  source: "unresolved",
  reason: "could not read",
};

describe("resolveSandbox", () => {
  it("reads the type Adobe reports for the matching sandbox", async () => {
    const c = client({
      sandboxes: [
        { name: "prod", title: "Prod", type: "production", state: "active" },
        { name: "focusgts-ucp", title: "Charlie", type: "development", state: "active" },
      ],
    });

    const info = await resolveSandbox(c, devCreds);
    expect(info.type).toBe("development");
    expect(info.name).toBe("focusgts-ucp");
    expect(info.source).toBe("adobe-api");
  });

  it("identifies a production sandbox", async () => {
    const c = client({ sandboxes: [{ name: "prod", type: "production" }] });
    const info = await resolveSandbox(c, creds);
    expect(info.type).toBe("production");
  });

  it("returns unknown when the sandbox is absent from the listing", async () => {
    const c = client({ sandboxes: [{ name: "somethingelse", type: "development" }] });
    const info = await resolveSandbox(c, creds);
    expect(info.type).toBe("unknown");
    expect(info.reason).toContain("not present");
  });

  it("returns unknown (not a crash) when the API call fails", async () => {
    const c = client(null, { status: 403 });
    const info = await resolveSandbox(c, creds);
    expect(info.type).toBe("unknown");
    expect(info.reason).toContain("403");
  });

  it("does NOT infer type from the sandbox name", async () => {
    // A sandbox literally named "prod" that Adobe classifies as development
    // must resolve as development — and vice versa. Name is never a signal.
    const c = client({ sandboxes: [{ name: "prod", type: "development" }] });
    const info = await resolveSandbox(c, creds);
    expect(info.type).toBe("development");
  });

  it("treats an unrecognised type string as unknown", async () => {
    const c = client({ sandboxes: [{ name: "prod", type: "staging-ish" }] });
    const info = await resolveSandbox(c, creds);
    expect(info.type).toBe("unknown");
  });
});

describe("assertWriteAllowed", () => {
  const saved = process.env.AEP_ALLOW_PRODUCTION_WRITES;

  beforeEach(() => {
    delete process.env.AEP_ALLOW_PRODUCTION_WRITES;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AEP_ALLOW_PRODUCTION_WRITES;
    else process.env.AEP_ALLOW_PRODUCTION_WRITES = saved;
  });

  describe("reads are always permitted", () => {
    for (const sandbox of [DEV, PROD, UNKNOWN, null]) {
      const label = sandbox?.type ?? "null";
      it(`allows GET against ${label}`, () => {
        expect(() => assertWriteAllowed("GET", "/x", sandbox)).not.toThrow();
      });
    }
  });

  describe("writes against a development sandbox", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      it(`allows ${method}`, () => {
        expect(() => assertWriteAllowed(method, "/x", DEV)).not.toThrow();
      });
    }
  });

  describe("writes against production are blocked", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      it(`blocks ${method}`, () => {
        expect(() => assertWriteAllowed(method, "/x", PROD)).toThrow(
          WriteBlockedError,
        );
      });
    }

    it("explains why, and how to override", () => {
      try {
        assertWriteAllowed("DELETE", "/x", PROD);
        throw new Error("should have thrown");
      } catch (e) {
        const m = (e as Error).message;
        expect(m).toContain("PRODUCTION");
        expect(m).toContain("AEP_MODE=production");
      }
    });
  });

  describe("fail-closed on unknown", () => {
    it("blocks writes when the sandbox type could not be resolved", () => {
      expect(() => assertWriteAllowed("POST", "/x", UNKNOWN)).toThrow(
        WriteBlockedError,
      );
    });

    it("blocks writes when resolution never ran (null)", () => {
      // A client that never had setSandboxInfo() called must not be writable.
      expect(() => assertWriteAllowed("POST", "/x", null)).toThrow(
        WriteBlockedError,
      );
    });

    it("surfaces the resolution failure reason in the error", () => {
      try {
        assertWriteAllowed("POST", "/x", UNKNOWN);
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("could not read");
      }
    });
  });

  describe("explicit override", () => {
    it("permits production writes when AEP_ALLOW_PRODUCTION_WRITES=true", () => {
      process.env.AEP_ALLOW_PRODUCTION_WRITES = "true";
      expect(() => assertWriteAllowed("DELETE", "/x", PROD)).not.toThrow();
    });

    it("permits writes against an unresolved sandbox under override", () => {
      process.env.AEP_ALLOW_PRODUCTION_WRITES = "1";
      expect(() => assertWriteAllowed("POST", "/x", UNKNOWN)).not.toThrow();
    });

    it("is NOT enabled by non-truthy values", () => {
      for (const v of ["false", "0", "no", "", "maybe"]) {
        process.env.AEP_ALLOW_PRODUCTION_WRITES = v;
        expect(productionWritesAllowed()).toBe(false);
        expect(() => assertWriteAllowed("POST", "/x", PROD)).toThrow();
      }
    });
  });
});


describe("write modes", () => {
  const savedMode = process.env.AEP_MODE;
  const savedLegacy = process.env.AEP_ALLOW_PRODUCTION_WRITES;

  beforeEach(() => {
    delete process.env.AEP_MODE;
    delete process.env.AEP_ALLOW_PRODUCTION_WRITES;
  });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.AEP_MODE;
    else process.env.AEP_MODE = savedMode;
    if (savedLegacy === undefined) delete process.env.AEP_ALLOW_PRODUCTION_WRITES;
    else process.env.AEP_ALLOW_PRODUCTION_WRITES = savedLegacy;
  });

  describe("resolveWriteMode", () => {
    it("defaults to safe", () => {
      expect(resolveWriteMode().mode).toBe("safe");
    });

    it("accepts each documented value", () => {
      for (const [input, expected] of [
        ["read-only", "read-only"],
        ["readonly", "read-only"],
        ["safe", "safe"],
        ["production", "production"],
        ["prod", "production"],
        ["PRODUCTION", "production"],
        ["  Safe  ", "safe"],
      ] as const) {
        process.env.AEP_MODE = input;
        expect(currentWriteMode()).toBe(expected);
      }
    });

    it("falls back to safe on an unrecognised value, and reports it", () => {
      // A typo must never fail open into production.
      process.env.AEP_MODE = "prodution";
      const r = resolveWriteMode();
      expect(r.mode).toBe("safe");
      expect(r.invalidValue).toBe("prodution");
    });

    it("honours the deprecated flag and marks it as legacy", () => {
      process.env.AEP_ALLOW_PRODUCTION_WRITES = "true";
      const r = resolveWriteMode();
      expect(r.mode).toBe("production");
      expect(r.viaLegacyFlag).toBe(true);
    });

    it("lets AEP_MODE win over the deprecated flag", () => {
      process.env.AEP_ALLOW_PRODUCTION_WRITES = "true";
      process.env.AEP_MODE = "read-only";
      expect(currentWriteMode()).toBe("read-only");
    });
  });

  describe("read-only mode", () => {
    it("blocks writes even in a development sandbox", () => {
      expect(() =>
        assertWriteAllowed("POST", "/x", DEV, "read-only"),
      ).toThrow(WriteBlockedError);
    });

    it("still allows reads", () => {
      expect(() =>
        assertWriteAllowed("GET", "/x", PROD, "read-only"),
      ).not.toThrow();
    });

    it("says it is read-only mode, not a sandbox problem", () => {
      try {
        assertWriteAllowed("POST", "/x", DEV, "read-only");
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("read-only mode");
      }
    });
  });

  describe("production mode", () => {
    for (const sandbox of [DEV, PROD, UNKNOWN, null]) {
      it(`allows writes against ${sandbox?.type ?? "an unresolved sandbox"}`, () => {
        expect(() =>
          assertWriteAllowed("DELETE", "/x", sandbox, "production"),
        ).not.toThrow();
      });
    }
  });

  it("keeps ProductionWriteBlockedError as an alias of WriteBlockedError", () => {
    expect(ProductionWriteBlockedError).toBe(WriteBlockedError);
  });

  it("productionWritesAllowed reflects the resolved mode", () => {
    expect(productionWritesAllowed()).toBe(false);
    process.env.AEP_MODE = "production";
    expect(productionWritesAllowed()).toBe(true);
  });
});
