import { describe, it, expect } from "vitest";
import { assertDeletable } from "../../../scripts/run-ledger.mjs";

/**
 * Cleanup must never be driven by a name search across a SHARED sandbox.
 * The only deletable id is one this run recorded creating, in phase 1b, under
 * this run's prefix, and absent from the baseline.
 */

const PREFIX = "mcpval-2026-08-14-run-uuid";
const OURS = "fake-created-id";

const ledger = () => ({
  runId: "run-uuid",
  prefix: PREFIX,
  baseline: { ids: ["baseline-1", "baseline-2"] },
  created: [{ id: OURS, name: `${PREFIX}-phase1`, phase: "1b" }],
});

describe("assertDeletable", () => {
  it("permits an id this run created in phase 1b under its prefix", () => {
    expect(() => assertDeletable(ledger(), OURS)).not.toThrow();
  });

  it("refuses an id absent from the ledger", () => {
    expect(() => assertDeletable(ledger(), "some-other-id")).toThrow(/ownership ledger/);
  });

  it("refuses a BASELINE id outright", () => {
    expect(() => assertDeletable(ledger(), "baseline-1")).toThrow(/BASELINE/);
  });

  it("refuses an id created in a different phase", () => {
    const l = ledger();
    l.created[0].phase = "2";
    expect(() => assertDeletable(l, OURS)).toThrow(/phase 2, not 1b/);
  });

  it("refuses a name lacking this run's prefix", () => {
    const l = ledger();
    l.created[0].name = "mcpval-2026-08-14-DIFFERENT-RUN-phase1";
    expect(() => assertDeletable(l, OURS)).toThrow(/prefix/);
  });

  it("refuses when the ledger records nothing created", () => {
    const l = ledger();
    l.created = [];
    expect(() => assertDeletable(l, OURS)).toThrow();
  });

  it("reports every failing reason at once, not just the first", () => {
    const l = ledger();
    l.created = [];
    l.baseline.ids.push(OURS);
    expect(() => assertDeletable(l, OURS)).toThrow(/ledger.*BASELINE|BASELINE.*ledger/s);
  });
});
