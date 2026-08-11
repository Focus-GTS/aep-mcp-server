import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  assertWriteAllowed,
  mutationsAllowed,
  MutationsDisabledError,
  ProductionSandboxNameError,
  WriteBlockedError,
  type SandboxInfo,
} from "../../../src/auth/sandbox-guard.js";

/**
 * The two gates added for v0.7.0, and — more importantly — every route by
 * which someone might try to get around them.
 *
 * These tests exist because the previous guard returned early on
 * `mode === "production"`, so a single environment variable was enough to
 * permit a mutation against a sandbox named `prod`.
 */

const DEV: SandboxInfo = { name: "dev1", type: "development", source: "adobe-api" };
const PROD_TYPED: SandboxInfo = { name: "prod", type: "production", source: "adobe-api" };
/** A sandbox NAMED prod that Adobe nonetheless classifies as development. */
const DEV_NAMED_PROD: SandboxInfo = { name: "prod", type: "development", source: "adobe-api" };

const ENV_KEYS = [
  "AEP_ALLOW_MUTATIONS",
  "AEP_SANDBOX_NAME",
  "AEP_MODE",
  "AEP_ALLOW_PRODUCTION_WRITES",
  "AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("gate 1 — AEP_ALLOW_MUTATIONS", () => {
  it("blocks mutations when unset, even in a development sandbox in safe mode", () => {
    expect(() => assertWriteAllowed("POST", "/x", DEV, "safe")).toThrow(
      MutationsDisabledError,
    );
  });

  it("blocks mutations when unset, even in production mode", () => {
    expect(() => assertWriteAllowed("POST", "/x", DEV, "production")).toThrow(
      MutationsDisabledError,
    );
  });

  it("never blocks reads, regardless of the flag", () => {
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(() => assertWriteAllowed(m, "/x", PROD_TYPED, "safe")).not.toThrow();
    }
  });

  it("allows the mutation once set, in a development sandbox", () => {
    process.env.AEP_ALLOW_MUTATIONS = "true";
    expect(() => assertWriteAllowed("POST", "/x", DEV, "safe")).not.toThrow();
  });

  it.each(["true", "TRUE", "1", "yes", "  true  "])(
    "accepts %j as opt-in",
    (v) => {
      process.env.AEP_ALLOW_MUTATIONS = v;
      expect(mutationsAllowed()).toBe(true);
    },
  );

  it.each(["false", "0", "no", "", "maybe", "TRUE!"])(
    "does not accept %j as opt-in",
    (v) => {
      process.env.AEP_ALLOW_MUTATIONS = v;
      expect(mutationsAllowed()).toBe(false);
    },
  );
});

describe("gate 2 — sandbox named prod is refused unconditionally", () => {
  beforeEach(() => {
    process.env.AEP_ALLOW_MUTATIONS = "true";
  });

  it("blocks a sandbox named prod in safe mode", () => {
    expect(() => assertWriteAllowed("POST", "/x", PROD_TYPED, "safe")).toThrow(
      ProductionSandboxNameError,
    );
  });

  it("BLOCKS a sandbox named prod even in production mode — the regression this fixes", () => {
    expect(() =>
      assertWriteAllowed("POST", "/x", PROD_TYPED, "production"),
    ).toThrow(ProductionSandboxNameError);
  });

  it("blocks even when Adobe classifies that sandbox as development", () => {
    // The name check is deliberately independent of the resolved type.
    expect(() =>
      assertWriteAllowed("POST", "/x", DEV_NAMED_PROD, "production"),
    ).toThrow(ProductionSandboxNameError);
  });

  it("blocks 'production' as well as 'prod', case-insensitively", () => {
    for (const name of ["prod", "PROD", "Production", " production "]) {
      const sb: SandboxInfo = { ...PROD_TYPED, name };
      expect(() => assertWriteAllowed("POST", "/x", sb, "production")).toThrow(
        ProductionSandboxNameError,
      );
    }
  });

  it("falls back to AEP_SANDBOX_NAME when the sandbox is unresolved", () => {
    process.env.AEP_SANDBOX_NAME = "prod";
    expect(() => assertWriteAllowed("POST", "/x", null, "production")).toThrow(
      ProductionSandboxNameError,
    );
  });

  it("does not block a normally-named sandbox", () => {
    expect(() => assertWriteAllowed("POST", "/x", DEV, "safe")).not.toThrow();
  });

  it("does not block a sandbox merely containing 'prod'", () => {
    const sb: SandboxInfo = { name: "prod-clone-dev", type: "development", source: "adobe-api" };
    expect(() => assertWriteAllowed("POST", "/x", sb, "safe")).not.toThrow();
  });

  it("lifts only with the explicit override", () => {
    process.env.AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD = "true";
    // Still needs the type/mode gates to pass; development type in safe mode.
    expect(() =>
      assertWriteAllowed("POST", "/x", DEV_NAMED_PROD, "safe"),
    ).not.toThrow();
  });

  it("the override does NOT bypass the type gate in safe mode", () => {
    process.env.AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD = "true";
    expect(() => assertWriteAllowed("POST", "/x", PROD_TYPED, "safe")).toThrow(
      WriteBlockedError,
    );
  });

  it("AEP_MODE=production alone does not imply the name override", () => {
    process.env.AEP_MODE = "production";
    expect(() =>
      assertWriteAllowed("POST", "/x", PROD_TYPED, "production"),
    ).toThrow(ProductionSandboxNameError);
  });

  it("the legacy AEP_ALLOW_PRODUCTION_WRITES flag does not imply it either", () => {
    process.env.AEP_ALLOW_PRODUCTION_WRITES = "true";
    expect(() =>
      assertWriteAllowed("POST", "/x", PROD_TYPED, "production"),
    ).toThrow(ProductionSandboxNameError);
  });
});

describe("gate ordering", () => {
  it("reports the mutation gate before the sandbox-name gate", () => {
    // Both would fail; the operator should be told about the cheaper fix first.
    process.env.AEP_SANDBOX_NAME = "prod";
    expect(() => assertWriteAllowed("DELETE", "/x", PROD_TYPED, "production")).toThrow(
      MutationsDisabledError,
    );
  });

  it("blocks every mutating verb", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() => assertWriteAllowed(m, "/x", DEV, "safe")).toThrow(
        MutationsDisabledError,
      );
    }
  });
});

describe("error messages name the fix", () => {
  it("MutationsDisabledError names the variable to set", () => {
    const e = new MutationsDisabledError("POST", "/x");
    expect(e.message).toContain("AEP_ALLOW_MUTATIONS=true");
  });

  it("ProductionSandboxNameError names the sandbox and the override", () => {
    const e = new ProductionSandboxNameError("DELETE", "/x", "prod");
    expect(e.message).toContain("'prod'");
    expect(e.message).toContain("AEP_I_UNDERSTAND_THIS_WRITES_TO_PROD");
    expect(e.message).toContain("AEP_MODE=production does not lift it");
  });

  it("no error message leaks a credential", () => {
    process.env.AEP_SANDBOX_NAME = "prod";
    const messages = [
      new MutationsDisabledError("POST", "/x").message,
      new ProductionSandboxNameError("POST", "/x", "prod").message,
    ];
    for (const m of messages) {
      expect(m).not.toMatch(/client_secret|Bearer |p8e-/i);
    }
  });
});
