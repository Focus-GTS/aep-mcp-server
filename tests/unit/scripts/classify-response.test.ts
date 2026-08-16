import { describe, it, expect } from "vitest";
import {
  classify,
  classifySandboxMembership,
  isEmptyCollection,
  isHtmlBody,
} from "../../../scripts/classify-response.mjs";

/**
 * The classification decides WHO acts on a failed probe — us, an Adobe admin,
 * the account team, or Adobe support. Getting it wrong sends someone to the
 * wrong place, so it is worth testing directly rather than eyeballing harness
 * output.
 *
 * Two of these assertions encode conclusions the untested version got wrong.
 */

const HTML_404 = "<!DOCTYPE html><html><title>404 Not Found</title></html>";

describe("2xx", () => {
  it("classifies a populated response as working access", () => {
    const r = classify({ status: 200, body: '{"results":[{"id":"a"}]}' });
    expect(r.code).toBe("WORKING_ACCESS");
  });

  it.each([
    ["sandboxes", '{"sandboxes":[]}'],
    ["results", '{"results":[]}'],
    ["definitions", '{"definitions":[]}'],
    ["bare array", "[]"],
  ])("classifies an empty %s collection as VALID_EMPTY, not working access", (_l, body) => {
    // The 2026-08-12 regression: `sandboxes: []` was reported as success. That
    // empty array was the most consequential result of the run.
    const r = classify({ status: 200, body });
    expect(r.code).toBe("VALID_EMPTY");
    expect(r.code).not.toBe("WORKING_ACCESS");
  });

  it("treats a non-collection 200 as working access", () => {
    expect(classify({ status: 200, body: '{"id":"x","type":"development"}' }).code).toBe(
      "WORKING_ACCESS",
    );
  });
});

describe("HTML 404 attribution depends on whether the endpoint is documented", () => {
  it("blames US when the endpoint IS documented", () => {
    const r = classify({ status: 404, body: HTML_404, documented: true });
    expect(r.code).toBe("IMPLEMENTATION_ERROR");
    expect(r.owner).toBe("us");
  });

  it("does NOT blame us when the endpoint is undocumented", () => {
    // /data/core/edge/datastreams — Adobe publishes no datastream
    // configuration API. An HTML 404 there may mean no such route exists,
    // which is not our defect and not a permissions problem.
    const r = classify({ status: 404, body: HTML_404, documented: false });
    expect(r.code).toBe("UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT");
    expect(r.owner).toMatch(/Adobe/);
  });

  it("never classifies an HTML 404 as a permissions problem", () => {
    for (const documented of [true, false]) {
      const r = classify({ status: 404, body: HTML_404, documented });
      expect(r.code).not.toBe("MISSING_PRODUCT_PROFILE_PERMISSION");
      expect(r.code).not.toBe("MISSING_ENTITLEMENT");
      expect(r.code).not.toBe("MISSING_SANDBOX_MEMBERSHIP");
    }
  });

  it("detects HTML from the content-type even when the body looks bare", () => {
    const r = classify({
      status: 404,
      body: "Not Found",
      contentType: "text/html; charset=utf-8",
      documented: false,
    });
    expect(r.code).toBe("UNSUPPORTED_OR_UNDOCUMENTED_ENDPOINT");
  });

  it("a JSON 404 is an entitlement signal, not an undocumented endpoint", () => {
    const r = classify({ status: 404, body: '{"title":"Not provisioned"}', documented: false });
    expect(r.code).toBe("MISSING_ENTITLEMENT");
  });
});

describe("4xx and 5xx", () => {
  it("403 is a product-profile permission, fixable by an Adobe admin", () => {
    const r = classify({ status: 403, body: '{"title":"ForbiddenError"}' });
    expect(r.code).toBe("MISSING_PRODUCT_PROFILE_PERMISSION");
    expect(r.owner).toMatch(/Admin Console/);
  });

  it("401 does not assert a missing SKU outright", () => {
    // Retracted claim: a Hygiene 401 was once reported as missing Data
    // Distiller. Adobe documents no such gate. The label must keep org,
    // sandbox, and profile ahead of entitlement.
    const r = classify({ status: 401, body: '{"title":"Access Denied"}' });
    expect(r.code).toBe("MISSING_ENTITLEMENT");
    expect(r.label).toMatch(/rule out org\/sandbox\/profile first/i);
  });

  it.each([405, 400])("%d is our bug", (status) => {
    expect(classify({ status, body: "{}" }).code).toBe("IMPLEMENTATION_ERROR");
  });

  it.each([500, 502, 503])("%d is server-side", (status) => {
    const r = classify({ status, body: "{}" });
    expect(r.code).toBe("SERVER_SIDE");
    expect(r.owner).toMatch(/x-request-id/);
  });

  it("an unrecognised status is flagged for investigation, not silently passed", () => {
    expect(classify({ status: 418, body: "{}" }).code).toBe("UNKNOWN");
  });
});

describe("sandbox membership is content, not status", () => {
  it("200 with the target sandbox listed is working access", () => {
    const r = classifySandboxMembership(
      '{"sandboxes":[{"name":"dev-sandbox","type":"development"}]}',
      "dev-sandbox",
    );
    expect(r.code).toBe("WORKING_ACCESS");
    expect(r.listed).toEqual(["dev-sandbox"]);
  });

  it("200 with an EMPTY list is missing sandbox membership", () => {
    // The live 2026-08-12 result.
    const r = classifySandboxMembership('{"sandboxes":[]}', "dev-sandbox");
    expect(r.code).toBe("MISSING_SANDBOX_MEMBERSHIP");
    expect(r.listed).toEqual([]);
  });

  it("200 listing OTHER sandboxes but not the target is still missing membership", () => {
    const r = classifySandboxMembership(
      '{"sandboxes":[{"name":"prod","type":"production"}]}',
      "dev-sandbox",
    );
    expect(r.code).toBe("MISSING_SANDBOX_MEMBERSHIP");
    expect(r.listed).toEqual(["prod"]);
  });

  it("never reports membership from a malformed body", () => {
    expect(classifySandboxMembership("not json", "dev-sandbox").code).toBe(
      "MISSING_SANDBOX_MEMBERSHIP",
    );
  });
});

describe("helpers", () => {
  it("isEmptyCollection is false for a populated collection", () => {
    expect(isEmptyCollection('{"results":[1]}')).toBe(false);
  });

  it("isEmptyCollection is false for non-JSON", () => {
    expect(isEmptyCollection("<html>")).toBe(false);
  });

  it("isHtmlBody detects a doctype prefix", () => {
    expect(isHtmlBody(HTML_404)).toBe(true);
  });

  it("isHtmlBody is false for JSON", () => {
    expect(isHtmlBody('{"a":1}', "application/json")).toBe(false);
  });
});

describe("every classification names an owner", () => {
  it("no code maps to an undefined label or owner", () => {
    const samples = [
      { status: 200, body: "{}" },
      { status: 200, body: "[]" },
      { status: 400, body: "{}" },
      { status: 401, body: "{}" },
      { status: 403, body: "{}" },
      { status: 404, body: "{}" },
      { status: 404, body: HTML_404, documented: false },
      { status: 404, body: HTML_404, documented: true },
      { status: 405, body: "{}" },
      { status: 500, body: "{}" },
      { status: 418, body: "{}" },
    ];
    for (const s of samples) {
      const r = classify(s);
      expect(r.label, JSON.stringify(s)).toBeTruthy();
      expect(r.owner, JSON.stringify(s)).toBeTruthy();
    }
  });
});

describe("a JSON 404 is not automatically an entitlement gap", () => {
  it("classifies Privacy Service's real empty-result 404 as VALID_EMPTY", () => {
    // Verified live 2026-08-14. The service validated the query, enforced the
    // regulation parameter, and reported that nothing matched.
    const body = JSON.stringify({
      errorCode: 404,
      title: "Resource not found",
      detail: "Not able to find job data.",
      errorType: "uri=/data/core/privacy/jobs",
    });
    const r = classify({ status: 404, body });
    expect(r.code).toBe("VALID_EMPTY");
    expect(r.code).not.toBe("MISSING_ENTITLEMENT");
  });

  it("still classifies an unprovisioned-sounding 404 as an entitlement gap", () => {
    const body = JSON.stringify({ title: "Not provisioned for this organization" });
    expect(classify({ status: 404, body }).code).toBe("MISSING_ENTITLEMENT");
  });

  it("an authorization-flavoured 404 is never read as an empty result", () => {
    const body = JSON.stringify({ detail: "You are not authorized to view Privacy jobs on this org" });
    expect(classify({ status: 404, body }).code).toBe("MISSING_ENTITLEMENT");
  });

  it("an opaque 404 stays an entitlement gap rather than guessing empty", () => {
    expect(classify({ status: 404, body: "{}" }).code).toBe("MISSING_ENTITLEMENT");
  });
});
