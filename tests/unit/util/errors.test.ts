import { describe, it, expect } from "vitest";
import {
  toolResult,
  toolError,
  mapApiError,
  AepApiError,
  MissingCredentialsError,
} from "../../../src/util/errors.js";

describe("toolResult", () => {
  it("wraps string data", () => {
    const result = toolResult("hello");
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.isError).toBeUndefined();
  });

  it("wraps object data as JSON", () => {
    const result = toolResult({ id: "123", name: "test" });
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ id: "123", name: "test" });
  });
});

describe("toolError", () => {
  it("returns error result with payload", () => {
    const result = toolError({ code: "TEST", message: "fail" });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("TEST");
    expect(parsed.message).toBe("fail");
  });

  it("includes details when provided", () => {
    const result = toolError({
      code: "ERR",
      message: "bad",
      details: { field: "name" },
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.details).toEqual({ field: "name" });
  });
});

describe("mapApiError", () => {
  it("maps AepApiError to payload with AEP_ prefix and whitelisted detail fields", () => {
    const err = new AepApiError(403, {
      title: "Forbidden",
      detail: "missing scope",
      "error-code": "ERR_SCOPE",
      // Fields outside the whitelist should be stripped by mapApiError to avoid
      // leaking sensitive Adobe diagnostic context.
      report: { internalId: "abc-123" },
      tenantInfo: { tenant: "secret" },
    });
    const payload = mapApiError(err);
    expect(payload.code).toBe("AEP_403");
    expect(payload.message).toContain("403");
    expect(payload.details).toEqual({
      title: "Forbidden",
      detail: "missing scope",
      "error-code": "ERR_SCOPE",
    });
  });

  it("maps generic Error", () => {
    const err = new Error("connection timeout");
    const payload = mapApiError(err);
    expect(payload.code).toBe("UNEXPECTED_ERROR");
    expect(payload.message).toBe("connection timeout");
  });

  it("maps unknown values", () => {
    const payload = mapApiError("something weird");
    expect(payload.code).toBe("UNKNOWN_ERROR");
    expect(payload.message).toBe("something weird");
  });
});

describe("AepApiError", () => {
  it("stores status and body", () => {
    const err = new AepApiError(404, { error: "not found" }, "Custom message");
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: "not found" });
    expect(err.message).toBe("Custom message");
    expect(err.name).toBe("AepApiError");
  });

  it("generates default message from status", () => {
    const err = new AepApiError(500, null);
    expect(err.message).toBe("AEP API returned 500");
  });
});

describe("MissingCredentialsError", () => {
  it("lists missing variables", () => {
    const err = new MissingCredentialsError(["AEP_CLIENT_ID", "AEP_ORG_ID"]);
    expect(err.message).toContain("AEP_CLIENT_ID");
    expect(err.message).toContain("AEP_ORG_ID");
    expect(err.name).toBe("MissingCredentialsError");
  });
});
