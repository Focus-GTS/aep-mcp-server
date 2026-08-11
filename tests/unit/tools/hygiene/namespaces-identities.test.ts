import { describe, it, expect } from "vitest";
import { toNamespacesIdentities } from "../../../../src/tools/hygiene/create-record-delete.js";

/**
 * Regression tests for the wire format of the record-delete payload.
 *
 * The tool originally sent a flat `identities` array. Adobe's Data Lifecycle
 * API requires `namespacesIdentities` — grouped by namespace, ids as a list.
 * The flat shape is accepted by nothing and fails silently at request time,
 * so this transform is the only thing standing between a friendly tool schema
 * and a request Adobe will reject.
 */
describe("toNamespacesIdentities", () => {
  it("groups a single namespace into one entry", () => {
    expect(
      toNamespacesIdentities([
        { namespace: "email", id: "a@example.com" },
        { namespace: "email", id: "b@example.com" },
      ]),
    ).toEqual([
      { namespace: { code: "email" }, ids: ["a@example.com", "b@example.com"] },
    ]);
  });

  it("splits distinct namespaces into separate entries", () => {
    expect(
      toNamespacesIdentities([
        { namespace: "email", id: "a@example.com" },
        { namespace: "ECID", id: "123" },
        { namespace: "email", id: "b@example.com" },
      ]),
    ).toEqual([
      { namespace: { code: "email" }, ids: ["a@example.com", "b@example.com"] },
      { namespace: { code: "ECID" }, ids: ["123"] },
    ]);
  });

  it("preserves first-appearance order so output is deterministic", () => {
    const out = toNamespacesIdentities([
      { namespace: "CRMID", id: "1" },
      { namespace: "email", id: "a@example.com" },
      { namespace: "ECID", id: "9" },
    ]);
    expect(out.map((e) => e.namespace.code)).toEqual(["CRMID", "email", "ECID"]);
  });

  it("collapses duplicate ids within a namespace", () => {
    expect(
      toNamespacesIdentities([
        { namespace: "email", id: "a@example.com" },
        { namespace: "email", id: "a@example.com" },
      ]),
    ).toEqual([{ namespace: { code: "email" }, ids: ["a@example.com"] }]);
  });

  it("keeps the same id under different namespaces", () => {
    expect(
      toNamespacesIdentities([
        { namespace: "email", id: "shared" },
        { namespace: "CRMID", id: "shared" },
      ]),
    ).toEqual([
      { namespace: { code: "email" }, ids: ["shared"] },
      { namespace: { code: "CRMID" }, ids: ["shared"] },
    ]);
  });

  it("is namespace-case-sensitive — ECID and ecid are not the same namespace", () => {
    const out = toNamespacesIdentities([
      { namespace: "ECID", id: "1" },
      { namespace: "ecid", id: "2" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("returns an empty array for no input", () => {
    expect(toNamespacesIdentities([])).toEqual([]);
  });

  it("never emits the flat shape Adobe rejects", () => {
    const out = toNamespacesIdentities([{ namespace: "email", id: "a@b.c" }]);
    for (const entry of out) {
      expect(entry).not.toHaveProperty("id");
      expect(typeof entry.namespace).toBe("object");
      expect(Array.isArray(entry.ids)).toBe(true);
    }
  });

  it("handles a large batch without loss", () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      namespace: "email",
      id: `user${i}@example.com`,
    }));
    const out = toNamespacesIdentities(many);
    expect(out).toHaveLength(1);
    expect(out[0].ids).toHaveLength(5000);
  });
});
